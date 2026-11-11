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
  }
}
