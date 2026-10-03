# Tests

Fast checks for the logic that's easy to break: repeats and exceptions, reminder timing, the message deck, and the calendar feed.
No browser and no database needed.

    bash tests/run.sh

The calendar-feed check uses independent Python libraries. One-time setup:

    python3 -m venv ~/.venvs/ics && ~/.venvs/ics/bin/pip install python-dateutil icalendar recurring-ical-events
    ICS_VENV=~/.venvs/ics bash tests/run.sh

What's covered: the app's repeat/stay/exception logic (`calendar.test.js`), the reminder function's decisions (`reminders.test.js`),
the message-of-the-day deck (`motd.test.js`), and the .ics feed versus the app's logic (`feed/`).
