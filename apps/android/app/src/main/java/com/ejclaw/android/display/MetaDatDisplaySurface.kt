package com.ejclaw.android.display

/**
 * Meta DAT integration point.
 *
 * Keep this class dependency-free until the Wearables Developer Center project,
 * GitHub Packages token, and DAT application id are available. The phone app can
 * validate EJClaw connectivity through NoopDisplaySurface first, then this class
 * can be swapped to call the Meta SDK.
 */
class MetaDatDisplaySurface : DisplaySurface {
    override fun showStatus(roomName: String, state: String, progress: String?) = Unit

    override fun showMessage(roomName: String, text: String) = Unit
}
