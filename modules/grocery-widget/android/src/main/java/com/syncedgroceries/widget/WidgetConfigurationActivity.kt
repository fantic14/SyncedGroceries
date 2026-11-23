package com.syncedgroceries.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import kotlin.math.roundToInt

internal fun Context.dp(value: Int) = (resources.displayMetrics.density * value).roundToInt()

internal fun Activity.panel(): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL
    setPadding(dp(16), dp(18), dp(16), dp(10))
    setContentView(this)
}

internal fun Context.heading(label: String) = TextView(this).apply {
    text = label
    textSize = 20f
    setTextColor(Color.rgb(23, 58, 53))
    setTypeface(null, Typeface.BOLD)
}

internal fun Context.button(label: String, action: () -> Unit) = Button(this).apply {
    text = label
    isAllCaps = false
    setOnClickListener { action() }
}

class WidgetConfigurationActivity : Activity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        setResult(RESULT_CANCELED)
        if (!bindableId(this, widgetId(intent))) finish()
    }

    override fun onResume() {
        super.onResume()
        if (isFinishing) return
        val box = panel()
        box.addView(heading("Choose a household list"))
        val list = activeList(this)
        if (list != null) {
            box.addView(button(list.name) {
                if (activeList(this)?.scope != list.scope) {
                    recreate()
                    return@button
                }
                val id = widgetId(intent)
                if (!WidgetBinding.save(this, id, list.scope)) {
                    Toast.makeText(this, "Couldn’t save the widget", Toast.LENGTH_SHORT).show()
                    return@button
                }
                GroceryWidgetProvider.updateAll(this)
                WidgetStore.refresh(this)
                setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
                finish()
            }, MATCH_PARENT, WRAP_CONTENT)
        } else {
            box.addView(TextView(this).apply {
                text = "Open your household list in Synced Groceries, then return here to select it."
                setPadding(0, dp(12), 0, dp(12))
            })
            box.addView(button("Open Synced Groceries") {
                packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it) }
            })
        }
        box.addView(button("Cancel") { finish() })
    }
}
