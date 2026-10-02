# Add to Trying My Best: iPhone Share Sheet shortcut

Lets you select text in Messages (or anywhere), tap Share, pick **Add to Trying My Best**, and land on the new-event form already filled in.
The app does the date reading; the Shortcut only has to hand it the text.

## Build it (about 3 minutes)

1. Open the **Shortcuts** app, tap **+**, and name it **Add to Trying My Best**.
2. Tap the **ⓘ** (details) button and turn on **Show in Share Sheet**. Under *Share Sheet Types*, leave only **Text** selected.
3. Add the action **URL Encode** (search "encode"). Set its input to **Shortcut Input**.
4. Add the action **Text** and type `https://cal.tryingmybest.org/?quick=` then tap the variable picker and insert the **URL Encoded Text** result from step 3 right after the `=`.
5. Add the action **Open URLs** and set its input to the Text from step 4.

Use it: in Messages, long-press a message, choose **More**, tap the bubble, then tap the **Share** arrow and pick **Add to Trying My Best**. (In other apps, select the text and tap **Share**.)

## Know before you build
- **It opens in Safari, not your Home Screen icon.** iPhone has no way to send a link into an installed web app. The form works the same, and events save to the same shared calendar. The first time, sign in once in Safari; it remembers you after that.
- I couldn't test Shortcuts from my side, so action names may differ a little between iOS versions. If a name doesn't match, search for the closest one.
- Nothing is ever saved automatically. The form opens filled in, and you press Save.

## No-Shortcut alternative (works in the Home Screen app)
Copy the text > open the app > **+** > **Quick add from text** > **Paste from clipboard** > **Read it** > check > **Save**.
iOS will show a small "Paste" confirmation the first time, that's normal.

## Link format (for the curious / other tools)
- `…/?quick=Dentist%20Thursday%20at%202pm`  (reads the date and time from the text)
- `…/?title=Dentist&date=2026-10-08&time=14:00&end=15:00&location=Main%20St&notes=Bring%20card`  (exact values; all optional)
