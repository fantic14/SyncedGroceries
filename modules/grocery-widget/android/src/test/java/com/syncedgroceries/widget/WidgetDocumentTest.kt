package com.syncedgroceries.widget

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WidgetDocumentTest {
    private val doc = WidgetDocument.create(JSONObject().put("scope", "house-a"))
    private val name = JSONObject().put("title", "Milk").put("quantity", "1")
    private fun checked(value: Boolean) = JSONObject().put("completed", value)
    private fun row(revision: Int, completed: Boolean) = JSONObject(name.toString())
        .put("id", "milk").put("revision", revision).put("completed", completed)
    private fun rows(doc: WidgetDocument) = doc.snapshot()!!.getJSONArray("items")
    private fun result(state: String, row: JSONObject) = JSONObject().put("status", state).put("item", row)

    @Test fun offlineChainSurvivesRestartAndRealtimeBeforeAcknowledgement() {
        assertTrue(doc.enqueue("milk", 0, name))
        assertTrue(doc.enqueue("milk", 1, checked(true)))
        val first = doc.next!!.getString("operationId")
        val reopened = WidgetDocument(JSONObject(doc.state.toString()))
        assertEquals(first, reopened.next!!.getString("operationId"))
        reopened.merge(row(1, false))
        assertEquals(2, rows(reopened).getJSONObject(0).getInt("revision"))
        assertTrue(rows(reopened).getJSONObject(0).getBoolean("completed"))
        assertTrue(reopened.finish(first, result("applied", row(1, false))))
        assertFalse(reopened.finish(first, result("applied", row(1, false))))
        val second = reopened.next!!
        assertEquals(1, second.getInt("baseRevision"))
        assertTrue(reopened.finish(second.getString("operationId"), result("applied", row(2, true))))
        assertFalse(reopened.merge(row(1, false)))
        assertEquals(0, reopened.pendingCount)
        assertTrue(rows(reopened).getJSONObject(0).getBoolean("completed"))
    }

    @Test fun conflictRejectsDependentDeletionAndPreservesOtherGroceries() {
        doc.merge(row(1, false))
        assertTrue(doc.enqueue("milk", 1, checked(true)))
        assertTrue(doc.enqueue("milk", 2, JSONObject().put("deleted", true)))
        assertTrue(doc.enqueue("bread", 0, JSONObject().put("title", "Bread").put("quantity", "1")))
        assertEquals(1, rows(doc).length())
        assertTrue(doc.finish(doc.next!!.getString("operationId"), result("conflict", row(2, false))))
        assertEquals(1, doc.pendingCount)
        assertEquals("bread", doc.next!!.getString("itemId"))
        assertEquals(2, rows(doc).length())
        assertTrue(doc.snapshot()!!.has("statusMessage"))
        assertFalse(doc.enqueue("milk", 1, checked(true)))
    }

    @Test fun expiredCredentialsHideListAndRetainPendingChangesUntilReauthentication() {
        doc.enqueue("milk", 0, name)
        val first = doc.next!!.getString("operationId")
        doc.state.put("suspended", true)
        assertNull(doc.snapshot())
        assertNull(doc.next)
        assertFalse(doc.enqueue("milk", 1, checked(true)))
        assertEquals(1, doc.pendingCount)
        doc.state.remove("suspended")
        assertEquals(first, doc.next!!.getString("operationId"))
    }
}
