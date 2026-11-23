package com.syncedgroceries.widget

import android.app.job.JobParameters
import android.app.job.JobService
import android.os.Handler
import android.os.Looper
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener

// JobScheduler waits for connectivity and supplies the wake lock during cold starts.
class WidgetTaskService : JobService(), HeadlessJsTaskEventListener, ReactInstanceEventListener {
    private val handler = Handler(Looper.getMainLooper())
    private var parameters: JobParameters? = null
    private var taskContext: HeadlessJsTaskContext? = null
    private var taskId: Int? = null
    private val host: ReactHost? get() = (application as ReactApplication).reactHost
    private val startupTimeout = Runnable { finish(true) }

    override fun onStartJob(params: JobParameters): Boolean {
        val host = host ?: return false
        parameters = params
        val context = host.currentReactContext
        if (context != null) onReactContextInitialized(context) else {
            host.addReactInstanceEventListener(this)
            handler.postDelayed(startupTimeout, 45_000)
            host.start()
        }
        return true
    }

    override fun onReactContextInitialized(context: ReactContext) {
        if (parameters == null || taskId != null) return
        handler.removeCallbacks(startupTimeout)
        host?.removeReactInstanceEventListener(this)
        val tasks = HeadlessJsTaskContext.getInstance(context)
        taskContext = tasks
        tasks.addTaskEventListener(this)
        taskId = tasks.startTask(HeadlessJsTaskConfig("SyncGroceryWidget", Arguments.createMap(), 90_000L, true))
    }

    override fun onHeadlessJsTaskStart(taskId: Int) {}

    override fun onHeadlessJsTaskFinish(taskId: Int) {
        if (taskId == this.taskId) finish(WidgetStore.hasPending(this))
    }

    private fun detach() {
        handler.removeCallbacks(startupTimeout)
        host?.removeReactInstanceEventListener(this)
        taskContext?.removeTaskEventListener(this)
        taskContext = null
        taskId = null
        parameters = null
    }

    private fun finish(retry: Boolean) {
        val params = parameters ?: return
        detach()
        jobFinished(params, retry)
    }

    override fun onStopJob(params: JobParameters): Boolean {
        detach()
        return true
    }
}
