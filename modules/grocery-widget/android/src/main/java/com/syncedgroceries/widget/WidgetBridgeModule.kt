package com.syncedgroceries.widget

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

class WidgetBridgeModule : Module() {
    private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

    override fun definition() = ModuleDefinition {
        Name("GroceryWidget")
        Function("identity") { WidgetStore.identity(context)?.toString() }
        Function("setIdentity") { value: String -> WidgetStore.setIdentity(context, JSONObject(value)) }
        Function("clear") { scope: String? -> WidgetStore.clear(context, scope) }
        Function("suspendScope") { scope: String -> WidgetStore.suspendScope(context, scope) }
        Function("next") { scope: String -> WidgetStore.next(context, scope)?.toString() }
        AsyncFunction("mergeRows") { scope: String, rows: String, fullList: Boolean -> WidgetStore.mergeRows(context, scope, JSONArray(rows), fullList) }
        AsyncFunction("finish") { scope: String, id: String, result: String ->
            WidgetStore.finish(context, scope, id, JSONObject(result))
        }
    }
}
