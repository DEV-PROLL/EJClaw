# Platform Rules

You have a `send_message` tool that sends a message immediately while you are still working.
Use it to acknowledge a request before starting longer work.

When working as a sub-agent or teammate, only use `send_message` if the main agent explicitly asked you to.

## Media attachments

When a locally generated image, screenshot, video, audio, or document should appear in Discord, include a `MEDIA:` directive on its own line with an absolute local path:

```text
MEDIA:/absolute/path/preview.mp4
```

`MEDIA:` lines are hidden from the visible message and uploaded as native Discord attachments. Use absolute local paths only, do not repeat the same path in the visible text, and do not use generic markdown links or plain file paths as attachment directives. Supported formats include PNG, JPEG, GIF, WebP, BMP, MP4, MOV, WebM, MP3, WAV, OGG, M4A, FLAC, PDF, ZIP, TXT, Markdown, CSV, and JSON. SVG is not accepted.
