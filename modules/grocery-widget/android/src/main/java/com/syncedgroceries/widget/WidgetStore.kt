package com.syncedgroceries.widget

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.util.AtomicFile
import android.util.Log
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import org.json.JSONArray
import org.json.JSONObject

// One file transaction couples each acknowledged operation to its returned server revision.
// Only display fields and scoped mutations live here. Supabase owns the credentials.
object WidgetStore {
    private const val JOB = 0x534757
    private fun file(context: Context) =
        AtomicFile(File(context.noBackupFilesDir, "grocery-widget.json"))

    private fun read(context: Context): JSONObject? = try {
        JSONObject(String(file(context).readFully(), Charsets.UTF_8))
    } catch (_: FileNotFoundException) {
        null
    }

    // Identity queries are frequent in the foreground. Keep only this small
    // projection in memory and read the full document when a widget needs it.
    private var identityLoaded = false
    private var metadata: JSONObject? = null
    private fun remember(state: JSONObject?) {
        metadata = state?.let {
            JSONObject(it, arrayOf("scope", "backend", "userId", "householdId", "joinedAt", "householdName", "suspended"))
                .put("pendingCount", it.getJSONArray("queue").length())
        }
        identityLoaded = true
    }

    private fun save(context: Context, state: JSONObject?) {
        val file = file(context)
        if (state == null) file.delete() else {
            val output = file.startWrite()
            try {
                output.write(state.toString().toByteArray(Charsets.UTF_8))
                file.finishWrite(output)
            } catch (error: Exception) {
                file.failWrite(output)
                throw error
            }
        }
        remember(state)
        // Launcher delivery can fail after the edit was durably committed.
        try {
            GroceryWidgetProvider.updateAll(context)
        } catch (error: RuntimeException) {
            Log.w("GroceryWidget", "Could not redraw widgets", error)
        }
    }

    @Synchronized fun setIdentity(context: Context, identity: JSONObject) {
        val current = this.identity(context)
        if (current?.optString("scope") == identity.getString("scope")) {
            val suspended = current.optBoolean("suspended")
            if (!suspended && current.getString("householdName") == identity.getString("householdName")) return
            val previous = read(context) ?: return
            previous.remove("suspended")
            save(context, previous.put("householdName", identity.getString("householdName")))
            if (suspended && previous.getJSONArray("queue").length() > 0) refresh(context)
        } else {
            if (current != null) save(context, null)
            save(context, WidgetDocument.create(identity).state)
        }
    }

    // expectedScope avoids clearing another membership after an old network request finishes.
    @Synchronized fun clear(context: Context, expectedScope: String?) {
        if (expectedScope == null || read(context)?.getString("scope") == expectedScope) {
            save(context, null)
        }
    }

    @Synchronized fun suspendScope(context: Context, scope: String) {
        val state = read(context) ?: return
        if (state.getString("scope") == scope && !state.optBoolean("suspended")) {
            save(context, state.put("suspended", true))
        }
    }

    @Synchronized fun identity(context: Context): JSONObject? {
        if (!identityLoaded) remember(read(context))
        return metadata?.let {
            JSONObject(it.toString()).put("bound", WidgetBinding.hasScope(context, it.getString("scope")))
        }
    }

    @Synchronized fun snapshot(context: Context) = read(context)?.let { WidgetDocument(it).snapshot() }

    @Synchronized fun enqueue(
        context: Context, scope: String, itemId: String, baseRevision: Int, changes: JSONObject
    ): Boolean {
        val doc = read(context)?.let(::WidgetDocument) ?: return false
        if (doc.scope != scope || !doc.enqueue(itemId, baseRevision, changes)) return false
        return try {
            save(context, doc.state)
            refresh(context)
            true
        } catch (_: IOException) {
            false
        }
    }

    @Synchronized fun next(context: Context, scope: String): JSONObject? {
        val doc = read(context)?.let(::WidgetDocument) ?: return null
        return if (doc.scope == scope) doc.next else null
    }

    @Synchronized fun mergeRows(context: Context, scope: String, rows: JSONArray, fullList: Boolean) {
        val doc = read(context)?.let(::WidgetDocument) ?: return
        if (scope != doc.scope) return
        var changed = fullList && !doc.state.optBoolean("loaded")
        if (fullList) doc.state.put("loaded", true)
        for (index in 0 until rows.length()) if (doc.merge(rows.getJSONObject(index))) changed = true
        if (changed) save(context, doc.state)
    }

    @Synchronized fun finish(context: Context, scope: String, operationId: String, result: JSONObject) {
        val doc = read(context)?.let(::WidgetDocument) ?: return
        if (scope == doc.scope && doc.finish(operationId, result)) save(context, doc.state)
    }

    @Synchronized fun hasPending(context: Context): Boolean {
        val saved = identity(context) ?: return false
        return !saved.optBoolean("suspended") && saved.getInt("pendingCount") > 0
    }

    fun refresh(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java)
        if (scheduler.getPendingJob(JOB) != null) return
        scheduler.schedule(JobInfo.Builder(JOB, ComponentName(context, WidgetTaskService::class.java))
            .setPersisted(true)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setMinimumLatency(0)
            .setBackoffCriteria(15_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
            .build())
    }
}
