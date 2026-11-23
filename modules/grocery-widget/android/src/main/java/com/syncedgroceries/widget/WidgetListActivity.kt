package com.syncedgroceries.widget

import android.app.Activity
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Paint
import android.os.Build
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.view.inputmethod.EditorInfo
import android.widget.BaseAdapter
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.util.UUID
import kotlin.math.abs

class WidgetListActivity : Activity() {
    private val scope get() = intent.getStringExtra(EXTRA_SCOPE)
    private var editing = false
    private var titleInput: EditText? = null
    private var message: TextView? = null
    private var titleView: TextView? = null
    private var rows = emptyList<GroceryRow>()
    private val adapter = RowAdapter()
    private val updates = object : BroadcastReceiver() {
        override fun onReceive(context: Context, event: Intent) { update() }
    }

    private fun boundList(): GroceryList? {
        if (WidgetBinding.get(this, widgetId(intent)) != scope) return null
        return activeList(this)?.takeIf { it.scope == scope }
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val list = boundList() ?: run { finish(); return }
        editing = state?.getBoolean("editing") ?: (intent.action == ACTION_ADD)
        if (editing) showAdd(list, state?.getString("title") ?: "")
        else showList(list)
        WidgetStore.refresh(this)
    }

    override fun onStart() {
        super.onStart()
        if (Build.VERSION.SDK_INT >= 33)
            registerReceiver(updates, IntentFilter(ACTION_UPDATED), Context.RECEIVER_NOT_EXPORTED)
        else {
            @Suppress("DEPRECATION")
            registerReceiver(updates, IntentFilter(ACTION_UPDATED))
        }
        update()
    }

    override fun onStop() {
        unregisterReceiver(updates)
        super.onStop()
    }

    override fun onSaveInstanceState(state: Bundle) {
        super.onSaveInstanceState(state)
        state.putBoolean("editing", editing)
        state.putString("title", titleInput?.text?.toString())
    }

    private fun update() {
        val list = boundList() ?: run { finish(); return }
        if (editing) return
        titleView?.text = list.name
        if (rows != list.rows) {
            rows = list.rows
            adapter.notifyDataSetChanged()
        }
        message?.text = list.message ?: if (rows.isEmpty()) "Your list is empty"
            else "Swipe right to check or uncheck. Swipe left to delete."
    }

    private fun showAdd(list: GroceryList, initialTitle: String) {
        editing = true
        val box = panel()
        box.addView(heading("Add to ${list.name}"))
        val input = EditText(this).apply {
            hint = "Item name"
            setSingleLine()
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            imeOptions = EditorInfo.IME_ACTION_DONE
            filters = arrayOf(InputFilter.LengthFilter(120))
            setText(initialTitle)
            setSelection(length())
        }
        titleInput = input
        box.addView(input, MATCH_PARENT, WRAP_CONTENT)
        fun save() {
            if (isFinishing) return
            val title = input.text.toString().trim()
            if (title.isEmpty()) { input.error = "Enter an item name"; return }
            if (enqueue(UUID.randomUUID().toString(), 0,
                    JSONObject().put("title", title).put("quantity", "1"))) finish()
        }
        input.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_DONE) { save(); true } else false
        }
        val buttons = LinearLayout(this).apply { gravity = Gravity.END }
        buttons.addView(button("Cancel") { finish() })
        buttons.addView(button("Add") { save() })
        box.addView(buttons)
        input.requestFocus()
        input.post { getSystemService(InputMethodManager::class.java).showSoftInput(input, InputMethodManager.SHOW_IMPLICIT) }
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE or
            WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
    }

    private fun showList(list: GroceryList) {
        val box = panel()
        val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        titleView = heading(list.name)
        header.addView(titleView, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        header.addView(button("+") { boundList()?.let { showAdd(it, "") } }.apply {
            contentDescription = "Add an item"
            minWidth = dp(48)
            minimumWidth = dp(48)
        })
        box.addView(header)
        message = TextView(this).apply { setPadding(0, dp(4), 0, dp(10)) }
        box.addView(message)
        rows = list.rows
        ListView(this).also {
            it.adapter = adapter
            val available = resources.displayMetrics.heightPixels
            val maxHeight = (available * 0.45f).toInt()
            box.addView(it, MATCH_PARENT, maxHeight)
            val index = rows.indexOfFirst { row -> row.id == intent.getStringExtra(EXTRA_ITEM) }
            if (index >= 0) it.setSelection(index)
        }
        box.addView(button("Done") { finish() })
        update()
    }

    private fun enqueue(id: String, revision: Int, changes: JSONObject): Boolean {
        val list = boundList() ?: run { finish(); return false }
        val saved = WidgetStore.enqueue(this, list.scope, id, revision, changes)
        if (!saved) Toast.makeText(this, "Couldn’t save this change", Toast.LENGTH_SHORT).show()
        update()
        return saved
    }

    private fun toggle(row: GroceryRow) {
        enqueue(row.id, row.revision, JSONObject().put("completed", !row.completed))
    }

    private fun delete(row: GroceryRow) {
        enqueue(row.id, row.revision, JSONObject().put("deleted", true))
    }

    private inner class RowAdapter : BaseAdapter() {
        override fun getCount() = rows.size
        override fun getItem(position: Int) = rows[position]
        override fun getItemId(position: Int) = position.toLong()

        override fun getView(position: Int, recycled: View?, parent: ViewGroup): View {
            val row = getItem(position)
            val line = LinearLayout(this@WidgetListActivity).apply {
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = dp(48)
            }
            val check = button(if (row.completed) "☑" else "☐") { toggle(row) }.apply {
                contentDescription = row.checkAction
            }
            line.addView(check, dp(48), dp(48))
            val label = TextView(this@WidgetListActivity).apply {
                text = row.label
                textSize = 16f
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(6), 0, dp(6), 0)
                if (row.completed) paintFlags = paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
                setOnClickListener {
                    AlertDialog.Builder(this@WidgetListActivity).setTitle(row.title)
                        .setItems(arrayOf(row.checkAction, "Delete")) { _, selected ->
                            if (selected == 0) toggle(row) else delete(row)
                        }.show()
                }
            }
            line.addView(label, LinearLayout.LayoutParams(0, MATCH_PARENT, 1f))
            var startX = 0f
            var startY = 0f
            label.setOnTouchListener { view, event ->
                val dx = event.rawX - startX
                val dy = event.rawY - startY
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> {
                        startX = event.rawX
                        startY = event.rawY
                        true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        if (abs(dx) > dp(10) && abs(dx) > abs(dy) * 1.5f) {
                            view.parent.requestDisallowInterceptTouchEvent(true)
                            view.translationX = dx.coerceIn(-dp(80).toFloat(), dp(80).toFloat())
                        }
                        true
                    }
                    MotionEvent.ACTION_UP -> {
                        view.translationX = 0f
                        view.parent.requestDisallowInterceptTouchEvent(false)
                        if (abs(dx) >= dp(56) && abs(dx) > abs(dy) * 1.5f) {
                            if (dx > 0) toggle(row) else delete(row)
                        } else if (abs(dx) < dp(10) && abs(dy) < dp(10)) view.performClick()
                        true
                    }
                    MotionEvent.ACTION_CANCEL -> { view.translationX = 0f; true }
                    else -> false
                }
            }
            return line
        }
    }
}
