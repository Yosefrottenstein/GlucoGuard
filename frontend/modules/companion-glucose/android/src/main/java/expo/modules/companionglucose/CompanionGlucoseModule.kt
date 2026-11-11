package expo.modules.companionglucose

import android.content.Intent
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CompanionGlucoseModule : Module() {
  private val ctx get() = appContext.reactContext ?: throw IllegalStateException("App not ready")

  override fun definition() = ModuleDefinition {
    Name("CompanionGlucose")

    Function("hasAccess") {
      NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName)
    }

    Function("openAccessSettings") {
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(intent)
    }

    // JSON array of {ts, sgv, unit, pkg} collected since the last call
    Function("drain") { GlucoseNotificationService.drain(ctx) }

    Function("lastSource") { GlucoseNotificationService.lastPackage(ctx) }
  }
}
