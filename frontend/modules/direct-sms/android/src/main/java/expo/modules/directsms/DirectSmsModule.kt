package expo.modules.directsms

import android.os.Build
import android.telephony.SmsManager
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Sends a text straight from the phone's own SIM card, like xDrip+ on Android (no user tap needed).
class DirectSmsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DirectSms")

    AsyncFunction("send") { phone: String, body: String ->
      val context = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "App not ready", null)
      val sms: SmsManager = if (Build.VERSION.SDK_INT >= 31) {
        context.getSystemService(SmsManager::class.java)
      } else {
        @Suppress("DEPRECATION")
        SmsManager.getDefault()
      }
      val parts = sms.divideMessage(body)
      sms.sendMultipartTextMessage(phone, null, parts, null, null)
      true
    }
  }
}
