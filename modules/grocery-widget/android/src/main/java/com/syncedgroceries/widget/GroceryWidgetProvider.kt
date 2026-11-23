package com.syncedgroceries.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import android.widget.Toast
import org.json.JSONObject

internal data class GroceryRow(
    val id: String,
    val title: String,
    val quantity: String,
    val completed: Boolean,
    val revision: Int
) {
    val label get() = if (quantity == "1" || quantity.isEmpty()) title else "$title · $quantity"
    val checkAction get() = if (completed) "Mark $title as needed" else "Mark $title as bought"
}

internal data class GroceryList(
    val scope: String,
    val name: String,
    val rows: List<GroceryRow>,
    val message: String?
)

internal fun activeList(context: Context): GroceryList? {
    val json = WidgetStore.snapshot(context) ?: return null
    val items = json.optJSONArray("items") ?: return null
    val rows = List(items.length()) { index ->
        val item = items.getJSONObject(index)
        GroceryRow(
            item.getString("id"), item.getString("title"), item.getString("quantity"),
            item.getBoolean("completed"), item.getInt("revision")
        )
    }.sortedBy { it.completed }
    return GroceryList(
        json.getString("scope"), json.getString("householdName"), rows,
        if (json.isNull("statusMessage")) null else json.optString("statusMessage").ifBlank { null }
    )
}

internal object WidgetBinding {
    private fun prefs(context: Context) =
        context.getSharedPreferences("grocery_widget_bindings", Context.MODE_PRIVATE)

    fun save(context: Context, id: Int, scope: String) =
        prefs(context).edit().putString(id.toString(), scope).commit()

    fun hasScope(context: Context, scope: String) = prefs(context).all.containsValue(scope)

    fun get(context: Context, id: Int): String? = prefs(context).getString(id.toString(), null)

    fun remove(context: Context, id: Int) = prefs(context).edit().remove(id.toString()).apply()
}

internal const val EXTRA_SCOPE = "groceryScope"
internal const val EXTRA_ITEM = "groceryItem"
internal const val ACTION_LIST = "com.syncedgroceries.widget.LIST"
internal const val ACTION_ADD = "com.syncedgroceries.widget.ADD"
internal const val ACTION_UPDATED = "com.syncedgroceries.widget.UPDATED"
private const val ACTION_CHECK = "com.syncedgroceries.widget.CHECK"

internal fun widgetId(intent: Intent) = intent.getIntExtra(
    AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID
)

private fun widgetIntent(context: Context, component: Class<*>, id: Int, action: String,
                         scope: String?, itemId: String? = null): Intent {
    // Intent identity includes the account binding and item. Reconfiguration invalidates old actions.
    val uri = Uri.Builder().scheme("widget").authority("groceries").appendPath(id.toString())
        .appendPath(action).appendPath(scope ?: "").appendPath(itemId ?: "").build()
    return Intent(context, component).setAction(action).setData(uri)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra(EXTRA_SCOPE, scope)
        .putExtra(EXTRA_ITEM, itemId)
}

internal fun bindableId(context: Context, id: Int): Boolean =
    AppWidgetManager.getInstance(context).getAppWidgetInfo(id)?.provider ==
        ComponentName(context, GroceryWidgetProvider::class.java)

class GroceryWidgetProvider : AppWidgetProvider() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_CHECK) {
            super.onReceive(context, intent)
            return
        }
        val id = widgetId(intent)
        val scope = intent.getStringExtra(EXTRA_SCOPE) ?: return
        if (WidgetBinding.get(context, id) != scope) return
        val list = activeList(context)?.takeIf { it.scope == scope } ?: return
        val row = list.rows.find { it.id == intent.getStringExtra(EXTRA_ITEM) } ?: return
        val revision = intent.getIntExtra("revision", -1)
        if (row.revision != revision) {
            updateAll(context)
            return
        }
        if (!WidgetStore.enqueue(context, scope, row.id, revision,
                JSONObject().put("completed", !row.completed))) {
            Toast.makeText(context, "Couldn’t update this item", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val list = activeList(context)
        ids.forEach { render(context, manager, it, list) }
        if (list != null && ids.any { WidgetBinding.get(context, it) == list.scope }) {
            WidgetStore.refresh(context)
        }
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int,
                                           options: Bundle) {
        render(context, manager, id, activeList(context))
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        ids.forEach { WidgetBinding.remove(context, it) }
    }

    override fun onRestored(context: Context, oldIds: IntArray, newIds: IntArray) {
        oldIds.zip(newIds).forEach { (old, new) ->
            WidgetBinding.get(context, old)?.let { WidgetBinding.save(context, new, it) }
            if (old != new) WidgetBinding.remove(context, old)
        }
    }

    companion object {
        private const val FLAGS = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, GroceryWidgetProvider::class.java))
            if (ids.isNotEmpty()) {
                val list = activeList(context)
                ids.forEach { render(context, manager, it, list) }
            }
            context.sendBroadcast(Intent(ACTION_UPDATED).setPackage(context.packageName))
        }

        private fun render(context: Context, manager: AppWidgetManager, id: Int, current: GroceryList?) {
            val list = current?.takeIf { it.scope == WidgetBinding.get(context, id) }
            fun panel(action: String, itemId: String? = null): PendingIntent {
                val intent = if (list == null)
                    widgetIntent(context, WidgetConfigurationActivity::class.java, id,
                        AppWidgetManager.ACTION_APPWIDGET_CONFIGURE, null)
                else widgetIntent(context, WidgetListActivity::class.java, id, action, list.scope, itemId)
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                return PendingIntent.getActivity(context, 0, intent, FLAGS)
            }

            val views = RemoteViews(context.packageName, R.layout.grocery_widget)
            views.setTextViewText(R.id.grocery_widget_title, list?.name ?: "Choose household")
            views.setOnClickPendingIntent(R.id.grocery_widget_title, panel(ACTION_LIST))
            views.setContentDescription(R.id.grocery_widget_title, list?.let { "Open ${it.name}, ${it.rows.size} items" } ?: "Choose household")
            views.setOnClickPendingIntent(R.id.grocery_widget_add, panel(ACTION_ADD))
            views.setViewVisibility(R.id.grocery_widget_add, if (list == null) View.GONE else View.VISIBLE)
            val message = when {
                list == null -> "Tap to choose a synced list"
                list.message != null -> list.message
                list.rows.isEmpty() -> "Your list is empty"
                else -> null
            }
            views.setTextViewText(R.id.grocery_widget_message, message)
            views.setViewVisibility(R.id.grocery_widget_message, if (message == null) View.GONE else View.VISIBLE)
            views.setOnClickPendingIntent(R.id.grocery_widget_message, panel(ACTION_LIST))
            views.removeAllViews(R.id.grocery_widget_rows)
            if (list != null) {
                val options = manager.getAppWidgetOptions(id)
                val landscape = context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
                val heightKey = if (landscape) AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT
                    else AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT
                val height = options.getInt(heightKey, 180)
                val maxRows = ((height - 48 - (if (message == null) 0 else 32)) / 44).coerceIn(1, 12)
                for (row in list.rows.take(maxRows)) {
                    val line = RemoteViews(context.packageName, R.layout.grocery_widget_row)
                    line.setTextViewText(R.id.grocery_widget_item, row.label)
                    line.setTextViewText(R.id.grocery_widget_check, if (row.completed) "☑" else "☐")
                    line.setContentDescription(R.id.grocery_widget_check, row.checkAction)
                    line.setOnClickPendingIntent(R.id.grocery_widget_item, panel(ACTION_LIST, row.id))
                    val toggle = widgetIntent(context, GroceryWidgetProvider::class.java, id, ACTION_CHECK,
                        list.scope, row.id).putExtra("revision", row.revision)
                    line.setOnClickPendingIntent(R.id.grocery_widget_check,
                        PendingIntent.getBroadcast(context, row.revision, toggle, FLAGS))
                    views.addView(R.id.grocery_widget_rows, line)
                }
            }
            manager.updateAppWidget(id, views)
        }
    }
}
