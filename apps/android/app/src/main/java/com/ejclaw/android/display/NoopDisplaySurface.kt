package com.ejclaw.android.display

class NoopDisplaySurface : DisplaySurface {
    var lastStatus: String = ""
        private set
    var lastMessage: String = ""
        private set

    override fun showStatus(roomName: String, state: String, progress: String?) {
        lastStatus = listOfNotNull(roomName, state, progress).joinToString(" / ")
    }

    override fun showMessage(roomName: String, text: String) {
        lastMessage = "$roomName: $text"
    }
}
