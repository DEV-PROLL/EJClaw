package com.ejclaw.android.api

import com.ejclaw.android.model.RoomActivity
import com.ejclaw.android.model.RoomMessage
import com.ejclaw.android.model.RoomSummary
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import org.json.JSONObject

class EJClawApi(
    baseUrl: String,
    private val token: String,
) {
    private val baseUrl = baseUrl.trim().trimEnd('/')

    fun health(): Boolean {
        val payload = request("GET", "/api/health")
        return JSONObject(payload).optBoolean("ok", false)
    }

    fun rooms(): List<RoomSummary> {
        val payload = request("GET", "/api/rooms-timeline")
        val root = JSONObject(payload)
        return root.keys().asSequence().mapNotNull { key ->
            root.optJSONObject(key)?.let { parseRoomSummary(it) }
        }.sortedBy { it.name.lowercase() }.toList()
    }

    fun roomTimeline(jid: String): RoomActivity {
        val payload = request("GET", "/api/rooms/${encode(jid)}/timeline")
        val room = JSONObject(payload)
        val messages = room.optJSONArray("messages") ?: return RoomActivity(parseRoomSummary(room), emptyList())
        return RoomActivity(
            parseRoomSummary(room),
            (0 until messages.length()).mapNotNull { index ->
                messages.optJSONObject(index)?.let { message ->
                    RoomMessage(
                        senderName = message.optString("senderName", message.optString("sender", "")),
                        content = message.optString("content", ""),
                        timestamp = message.optString("timestamp", ""),
                        fromMe = message.optBoolean("isFromMe", false),
                    )
                }
            },
        )
    }

    fun sendRoomMessage(jid: String, text: String, nickname: String): Boolean {
        val body = JSONObject()
            .put("requestId", UUID.randomUUID().toString())
            .put("text", text)
            .put("nickname", nickname.ifBlank { "android" })
        val payload = request("POST", "/api/rooms/${encode(jid)}/messages", body.toString())
        return JSONObject(payload).optBoolean("ok", false)
    }

    private fun parseRoomSummary(room: JSONObject): RoomSummary {
        val messages = room.optJSONArray("messages")
        val latest = if (messages != null && messages.length() > 0) {
            messages.optJSONObject(messages.length() - 1)?.optString("content", "") ?: ""
        } else {
            ""
        }
        return RoomSummary(
            jid = room.optString("jid"),
            name = room.optString("name", room.optString("jid")),
            status = room.optString("status", "unknown"),
            latestText = latest.take(120),
        )
    }

    private fun request(method: String, path: String, body: String? = null): String {
        val connection = URL("$baseUrl$path").openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 8_000
        connection.readTimeout = 12_000
        connection.setRequestProperty("Accept", "application/json")
        if (token.isNotBlank()) connection.setRequestProperty("Authorization", "Bearer $token")
        if (body != null) {
            val bytes = body.toByteArray(Charsets.UTF_8)
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Content-Length", bytes.size.toString())
            connection.outputStream.use { it.write(bytes) }
        }
        val status = connection.responseCode
        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
        val response = stream?.use {
            BufferedReader(InputStreamReader(it, Charsets.UTF_8)).readText()
        } ?: ""
        connection.disconnect()
        if (status !in 200..299) {
            val message = response.ifBlank { "HTTP $status" }
            throw IllegalStateException(message)
        }
        return response
    }

    private fun encode(value: String): String =
        java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
}
