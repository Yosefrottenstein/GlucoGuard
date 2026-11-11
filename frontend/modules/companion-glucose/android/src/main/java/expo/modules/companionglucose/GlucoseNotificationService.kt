package expo.modules.companionglucose

import android.app.Notification
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject

// "Companion app" mode, like xDrip+: reads the glucose value that CGM / pump apps show in their notification.
class GlucoseNotificationService : NotificationListenerService() {

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    val pkg = sbn.packageName ?: return
    if (PREFIXES.none { pkg.startsWith(it) }) return
    val texts = mutableListOf<String>()
    val extras = sbn.notification.extras
    for (key in listOf(Notification.EXTRA_TITLE, Notification.EXTRA_TEXT, Notification.EXTRA_BIG_TEXT, Notification.EXTRA_SUB_TEXT)) {
      extras.getCharSequence(key)?.toString()?.let { texts.add(it) }
    }
    // Dexcom and others draw the value in a custom layout; inflate it and read its text views
    try {
      @Suppress("DEPRECATION")
      val views = sbn.notification.contentView ?: sbn.notification.bigContentView
      if (views != null) {
        val root = views.apply(applicationContext, FrameLayout(applicationContext))
        collect(root, texts)
      }
    } catch (_: Throwable) {}
    val reading = parse(texts) ?: return
    store(applicationContext, pkg, reading.first, reading.second)
    val ctx = applicationContext
    Thread { uploadPending(ctx) }.start()
  }

  private fun collect(v: View, out: MutableList<String>) {
    if (v is TextView) v.text?.toString()?.let { if (it.isNotBlank()) out.add(it) }
    if (v is ViewGroup) for (i in 0 until v.childCount) collect(v.getChildAt(i), out)
  }

  companion object {
    val PREFIXES = listOf(
      "com.dexcom.", "com.freestylelibre", "com.abbott.", "com.insulet.", "com.camdiab.", "com.senseonics.",
      "com.medtrum.", "com.betabionics", "com.sequel", "com.tandemdiabetes.", "com.medtronic.", "com.microtechmd.", "com.sinocare."
    )
    private const val PREFS = "companion_glucose"
    private val MMOL = Regex("(?<![\\d.,])(\\d{1,2}[.,]\\d)(?![\\d])")
    private val MGDL = Regex("(?<![\\d.,])(\\d{2,3})(?![\\d.,:])")

    /** Returns (mg/dL value, "mgdl"|"mmol") from notification texts, or null. Only texts that are just a value
     *  (optionally with unit / trend arrow) count, so "45 minutes ago" or "Pod 20 U" are ignored. */
    fun parse(texts: List<String>): Pair<Int, String>? {
      for (raw in texts) {
        val t = raw.replace('\u00a0', ' ').lowercase()
          .replace("mg/dl", " ").replace("mmol/l", " ")
          .replace(Regex("[\\u2190-\\u21ff\\u2b00-\\u2bff\\u27a0-\\u27bf→↗↘↑↓↖↙⇈⇊]"), " ").trim()
        if (t.isEmpty() || t.any { it.isLetter() } || t.contains("%") || t.contains(":")) continue
        // a value on its own must look like a glucose reading, not a bare counter like "100" battery
        if (t.length > 5) continue
        MMOL.find(t)?.let { m ->
          val v = m.groupValues[1].replace(',', '.').toDoubleOrNull()
          if (v != null && v in 2.2..33.3) return Pair(Math.round(v * 18.0182).toInt(), "mmol")
        }
        MGDL.find(t)?.let { m ->
          val v = m.groupValues[1].toIntOrNull()
          if (v != null && v in 39..401) return Pair(v, "mgdl")
        }
      }
      return null
    }

    fun store(ctx: Context, pkg: String, sgv: Int, unit: String) {
      val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      synchronized(this) {
        val arr = JSONArray(prefs.getString("pending", "[]"))
        val now = System.currentTimeMillis()
        if (arr.length() > 0) {
          val last = arr.getJSONObject(arr.length() - 1)
          if (last.getInt("sgv") == sgv && now - last.getLong("ts") < 60_000) return
        }
        arr.put(JSONObject().put("ts", now).put("sgv", sgv).put("unit", unit).put("pkg", pkg))
        val trimmed = JSONArray()
        for (i in maxOf(0, arr.length() - 500) until arr.length()) trimmed.put(arr.get(i))
        prefs.edit().putString("pending", trimmed.toString()).putString("last_pkg", pkg).apply()
      }
    }

    fun drain(ctx: Context): String {
      val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      synchronized(this) {
        val s = prefs.getString("pending", "[]") ?: "[]"
        prefs.edit().putString("pending", "[]").apply()
        return s
      }
    }

    fun lastPackage(ctx: Context): String? = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("last_pkg", null)

    private fun direction(perMin: Double) = when {
      perMin <= -3 -> "DoubleDown"; perMin <= -2 -> "SingleDown"; perMin <= -1 -> "FortyFiveDown"
      perMin < 1 -> "Flat"; perMin < 2 -> "FortyFiveUp"; perMin < 3 -> "SingleUp"; else -> "DoubleUp"
    }

    /** Background upload straight to the GlucoGuard server, so readings, alarms and emergency messages keep
     *  flowing while the app is closed. Keeps ~1 reading per 5 min; leaves items queued if offline. */
    fun uploadPending(ctx: Context) {
      val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val base = prefs.getString("base_url", "") ?: ""
      val token = prefs.getString("token", "") ?: ""
      if (base.isEmpty() || token.isEmpty()) return
      val items = JSONArray(drain(ctx))
      if (items.length() == 0) return
      var lastTs = prefs.getLong("last_up_ts", 0L)
      var lastSgv = prefs.getInt("last_up_sgv", 0)
      val out = JSONArray()
      val iso = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
      for (i in 0 until items.length()) {
        val it = items.getJSONObject(i)
        val ts = it.getLong("ts"); val sgv = it.getInt("sgv")
        if (ts - lastTs < 270_000) continue
        val dir = if (lastTs > 0 && ts - lastTs < 900_000) direction((sgv - lastSgv) / ((ts - lastTs) / 60000.0)) else "NONE"
        out.put(JSONObject().put("ts", iso.format(java.util.Date(ts))).put("sgv", sgv).put("direction", dir))
        lastTs = ts; lastSgv = sgv
      }
      if (out.length() == 0) return
      try {
        val conn = java.net.URL("$base/readings/batch").openConnection() as java.net.HttpURLConnection
        conn.requestMethod = "POST"
        conn.connectTimeout = 15000; conn.readTimeout = 15000
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("Authorization", "Bearer $token")
        conn.outputStream.use { os -> os.write(JSONObject().put("source", "companion").put("readings", out).toString().toByteArray()) }
        val code = conn.responseCode
        conn.disconnect()
        if (code in 200..299) {
          prefs.edit().putLong("last_up_ts", lastTs).putInt("last_up_sgv", lastSgv).apply()
          return
        }
      } catch (_: Throwable) {}
      // failed: put the raw items back so the next notification (or the app) retries
      synchronized(this) {
        val now = JSONArray(prefs.getString("pending", "[]"))
        val merged = JSONArray()
        for (i in 0 until items.length()) merged.put(items.get(i))
        for (i in 0 until now.length()) merged.put(now.get(i))
        prefs.edit().putString("pending", merged.toString()).apply()
      }
    }
  }
}
