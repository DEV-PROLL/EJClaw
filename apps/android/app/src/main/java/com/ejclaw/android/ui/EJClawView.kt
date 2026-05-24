package com.ejclaw.android.ui

import android.app.Activity
import android.graphics.Typeface
import android.text.InputType
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ScrollView
import android.widget.TextView
import com.ejclaw.android.model.RoomSummary

class EJClawView(
    activity: Activity,
) {
    val baseUrlInput = EditText(activity)
    val tokenInput = EditText(activity)
    val nicknameInput = EditText(activity)
    val connectButton = Button(activity)
    val refreshButton = Button(activity)
    val sendButton = Button(activity)
    val messageInput = EditText(activity)
    val statusView = TextView(activity)
    val threadView = TextView(activity)
    val roomsAdapter = ArrayAdapter<RoomSummary>(activity, android.R.layout.simple_list_item_1)
    val roomsList = ListView(activity)
    val root: View

    init {
        baseUrlInput.hint = "http://100.101.210.95:8734"
        baseUrlInput.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        tokenInput.hint = "WEB_DASHBOARD_TOKEN"
        tokenInput.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        nicknameInput.hint = "nickname"
        nicknameInput.inputType = InputType.TYPE_CLASS_TEXT
        messageInput.hint = "message"
        messageInput.minLines = 2

        connectButton.text = "Connect"
        refreshButton.text = "Refresh"
        sendButton.text = "Send"
        statusView.text = "Disconnected"
        threadView.text = "Select a room"
        threadView.setTypeface(Typeface.MONOSPACE)
        roomsList.adapter = roomsAdapter

        val controls = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 12)
            addView(baseUrlInput)
            addView(tokenInput)
            addView(nicknameInput)
            addView(LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(connectButton, LinearLayout.LayoutParams(0, -2, 1f))
                addView(refreshButton, LinearLayout.LayoutParams(0, -2, 1f))
            })
            addView(statusView)
        }
        val scroll = ScrollView(activity).apply {
            addView(threadView)
        }
        val sendRow = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(messageInput, LinearLayout.LayoutParams(0, -2, 1f))
            addView(sendButton)
        }

        root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            addView(controls)
            addView(roomsList, LinearLayout.LayoutParams(-1, 0, 1f))
            addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
            addView(sendRow)
        }
    }
}
