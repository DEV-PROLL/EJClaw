package com.ejclaw.android.model

data class RoomSummary(
    val jid: String,
    val name: String,
    val status: String,
    val latestText: String,
) {
    override fun toString(): String {
        val suffix = if (latestText.isBlank()) "" else "\n$latestText"
        return "$name  [$status]$suffix"
    }
}

data class RoomMessage(
    val senderName: String,
    val content: String,
    val timestamp: String,
    val fromMe: Boolean,
)

data class RoomActivity(
    val summary: RoomSummary,
    val messages: List<RoomMessage>,
)
