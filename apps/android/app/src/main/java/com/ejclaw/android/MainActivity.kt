package com.ejclaw.android

import android.app.Activity
import android.os.Bundle
import android.widget.Toast
import com.ejclaw.android.api.EJClawApi
import com.ejclaw.android.display.DisplayBridge
import com.ejclaw.android.model.RoomActivity
import com.ejclaw.android.model.RoomSummary
import com.ejclaw.android.ui.EJClawView
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private val displayBridge = DisplayBridge()
    private lateinit var view: EJClawView
    private var api: EJClawApi? = null
    private var selectedRoom: RoomSummary? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        view = EJClawView(this)
        setContentView(view.root)
        loadPrefs()
        bindActions()
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun bindActions() {
        view.connectButton.setOnClickListener { connectAndLoadRooms() }
        view.refreshButton.setOnClickListener { loadRooms() }
        view.sendButton.setOnClickListener { sendMessage() }
        view.roomsList.setOnItemClickListener { _, _, position, _ ->
            selectedRoom = view.roomsAdapter.getItem(position)
            selectedRoom?.let { loadRoom(it) }
        }
    }

    private fun loadPrefs() {
        val prefs = getPreferences(MODE_PRIVATE)
        view.baseUrlInput.setText(prefs.getString("baseUrl", "http://100.101.210.95:8734"))
        view.tokenInput.setText(prefs.getString("token", ""))
        view.nicknameInput.setText(prefs.getString("nickname", "android"))
    }

    private fun savePrefs() {
        getPreferences(MODE_PRIVATE).edit()
            .putString("baseUrl", view.baseUrlInput.text.toString().trim())
            .putString("token", view.tokenInput.text.toString())
            .putString("nickname", view.nicknameInput.text.toString().trim())
            .apply()
    }

    private fun connectAndLoadRooms() {
        savePrefs()
        api = EJClawApi(
            view.baseUrlInput.text.toString(),
            view.tokenInput.text.toString(),
        )
        runNetwork("Connecting") {
            requireNotNull(api).health()
            requireNotNull(api).rooms()
        }.onSuccess { rooms ->
            view.statusView.text = "Connected: ${rooms.size} rooms"
            replaceRooms(rooms)
        }
    }

    private fun loadRooms() {
        runNetwork("Loading rooms") {
            requireNotNull(api ?: createApi()).rooms()
        }.onSuccess { rooms ->
            view.statusView.text = "Loaded: ${rooms.size} rooms"
            replaceRooms(rooms)
        }
    }

    private fun loadRoom(room: RoomSummary) {
        runNetwork("Loading ${room.name}") {
            requireNotNull(api ?: createApi()).roomTimeline(room.jid)
        }.onSuccess { activity ->
            renderRoom(activity)
            displayBridge.updateRoom(activity.summary.name, activity.summary.status, null)
            displayBridge.showLatest(activity.summary.name, activity.summary.latestText)
        }
    }

    private fun sendMessage() {
        val room = selectedRoom ?: return toast("Select a room first")
        val text = view.messageInput.text.toString().trim()
        if (text.isBlank()) return
        runNetwork("Sending") {
            requireNotNull(api ?: createApi()).sendRoomMessage(
                room.jid,
                text,
                view.nicknameInput.text.toString(),
            )
            requireNotNull(api).roomTimeline(room.jid)
        }.onSuccess { activity ->
            view.messageInput.setText("")
            renderRoom(activity)
        }
    }

    private fun createApi(): EJClawApi {
        savePrefs()
        val next = EJClawApi(view.baseUrlInput.text.toString(), view.tokenInput.text.toString())
        api = next
        return next
    }

    private fun replaceRooms(rooms: List<RoomSummary>) {
        view.roomsAdapter.clear()
        view.roomsAdapter.addAll(rooms)
        view.roomsAdapter.notifyDataSetChanged()
    }

    private fun renderRoom(activity: RoomActivity) {
        val lines = activity.messages.takeLast(40).joinToString("\n\n") { message ->
            val marker = if (message.fromMe) "me" else message.senderName.ifBlank { "agent" }
            "[$marker] ${message.content}"
        }
        view.threadView.text = lines.ifBlank { "No messages" }
        view.statusView.text = "${activity.summary.name}: ${activity.summary.status}"
    }

    private fun <T> runNetwork(label: String, block: () -> T): PendingUi<T> {
        view.statusView.text = label
        val pending = PendingUi<T>()
        executor.execute {
            try {
                val result = block()
                runOnUiThread { pending.succeed(result) }
            } catch (error: Throwable) {
                runOnUiThread {
                    view.statusView.text = "Error: ${error.message}"
                    toast(error.message ?: "Request failed")
                }
            }
        }
        return pending
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}

private class PendingUi<T> {
    private var callback: ((T) -> Unit)? = null
    private var result: T? = null

    fun onSuccess(next: (T) -> Unit) {
        callback = next
        result?.let(next)
    }

    fun succeed(value: T) {
        result = value
        callback?.invoke(value)
    }
}
