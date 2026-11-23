package com.syncedgroceries.widget

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

// A private display cache with an ordered outbox. Its owner commits the entire
// document atomically, so restart can only replay the exact same RPC.
internal class WidgetDocument(val state: JSONObject) {
    val scope get() = state.getString("scope")
    val suspended get() = state.optBoolean("suspended")
    private val items get() = state.getJSONObject("items")
    private val queue get() = state.getJSONArray("queue")
    val pendingCount get() = queue.length()
    val next: JSONObject? get() = if (suspended) null else queue.optJSONObject(0)

    private fun projectedItems(): JSONObject {
        val rows = JSONObject(items.toString())
        for (i in 0 until queue.length()) {
            val op = queue.getJSONObject(i)
            val id = op.getString("itemId")
            val changes = op.getJSONObject("changes")
            val row = rows.optJSONObject(id) ?: JSONObject().put("id", id).put("completed", false)
            // Realtime can deliver our committed item before the RPC acknowledgment.
            if (row.optLong("revision") != op.getLong("baseRevision")) continue
            changes.keys().forEach { key -> row.put(key, changes.get(key)) }
            row.put("revision", op.getLong("baseRevision") + 1)
            rows.put(id, row)
        }
        return rows
    }

    fun snapshot(): JSONObject? {
        if (suspended) return null
        val rows = projectedItems()
        val visible = rows.keys().asSequence().map(rows::getJSONObject)
            .filterNot { it.optBoolean("deleted") }.toList()
        val message = when {
            state.has("statusMessage") -> state.getString("statusMessage")
            pendingCount > 0 -> "Waiting to sync"
            !state.optBoolean("loaded") -> "Waiting for household list"
            else -> null
        }
        return JSONObject(state, arrayOf("scope", "userId", "householdId", "householdName"))
            .put("items", JSONArray(visible)).put("statusMessage", message)
    }

    fun enqueue(itemId: String, baseRevision: Int, changes: JSONObject): Boolean {
        val row = projectedItems().optJSONObject(itemId)
        if (suspended || row?.optBoolean("deleted") == true ||
            (row?.getInt("revision") ?: 0) != baseRevision) return false
        queue.put(JSONObject().put("operationId", UUID.randomUUID().toString())
            .put("itemId", itemId).put("baseRevision", baseRevision).put("changes", changes))
        state.remove("statusMessage")
        return true
    }

    fun merge(row: JSONObject): Boolean {
        val id = row.getString("id")
        if ((items.optJSONObject(id)?.getLong("revision") ?: 0L) >= row.getLong("revision")) return false
        items.put(id, row)
        return true
    }

    fun finish(operationId: String, result: JSONObject): Boolean {
        val head = next ?: return false
        if (head.getString("operationId") != operationId) return false
        result.optJSONObject("item")?.let(::merge)
        val remaining = (1 until queue.length()).map(queue::getJSONObject)
        if (result.getString("status") == "conflict") {
            state.put("statusMessage", "Item changed. Check it and try again.")
            // Later edits on this item depend on the rejected revision.
            state.put("queue", JSONArray(remaining.filter { it.getString("itemId") != head.getString("itemId") }))
        } else state.put("queue", JSONArray(remaining))
        return true
    }

    companion object {
        fun create(identity: JSONObject) =
            WidgetDocument(identity.put("items", JSONObject()).put("queue", JSONArray()))
    }
}
