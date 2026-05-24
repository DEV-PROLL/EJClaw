package com.ejclaw.android.display

interface DisplaySurface {
    fun showStatus(roomName: String, state: String, progress: String?)
    fun showMessage(roomName: String, text: String)
}
