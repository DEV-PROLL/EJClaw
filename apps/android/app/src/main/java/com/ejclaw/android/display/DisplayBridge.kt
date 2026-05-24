package com.ejclaw.android.display

class DisplayBridge(
    private val surface: DisplaySurface = NoopDisplaySurface(),
) {
    fun updateRoom(roomName: String, status: String, progress: String?) {
        surface.showStatus(roomName, status, progress)
    }

    fun showLatest(roomName: String, text: String) {
        if (text.isNotBlank()) surface.showMessage(roomName, text)
    }
}
