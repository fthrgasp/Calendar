// Message of the day. Add your own lines: put a quote in the list, save, upload this file. That's it.
//
//   clean  = shown to everyone
//   spicy  = only shown on devices where "Spicy messages" is switched on in Settings
//
// Each section is a pool of lines. One is picked per day (same for everyone), so adding lines never breaks anything.
// Remember a comma after every line, and use "double quotes" (if a line contains a double quote, write \" instead).
//
// Context sections only appear when they apply (about 4 days in 10, and "soon" always wins when it applies):
//   empty   = nothing on today          busy    = 4+ things today
//   friday / monday / weekend           soon    = something starts within the hour. {title} and {mins} get filled in.

window.MOTD = {
  general: {
    clean: [
      "Today's forecast: probably fine.",
      "Plans are just wishes with a time attached.",
      "Be the person your calendar thinks you are.",
      "Nothing is on fire. Probably.",
      "Hydrate. Then continue ignoring everything else.",
      "A reminder is just a very polite nag.",
      "Somewhere, a dentist is expecting you.",
      "Early meetings build character. So does coffee.",
      "Today is a great day to be on time.",
      "The best time to write it down was before you forgot. The second best time is now.",
      "Calendars don't lie. People who don't check them do.",
      "May all your appointments be short and your parking be free.",
      "The couch is not on the calendar. Plan accordingly.",
      "Be kind. Everyone is running late to something.",
      "Rest is also an appointment.",
      "The thing you're dreading is shorter than the dread.",
      "Don't forget: snacks.",
      "You are the main character of a very full week.",
      "Sync complete. Reality pending.",
      "A day without a plan is just a day with surprises.",
      "If in doubt, add it to the calendar.",
      "Check your pockets. Phone, keys, courage.",
      "Fortune says: you will check this calendar again within the hour.",
      "The early bird gets the worm. The worm should have slept in.",
      "Tomorrow-you will be grateful for what today-you writes down.",
      "Somewhere between 'too early' and 'too late' lies 'on time'. Aim there.",
      "Go touch some grass. Put it on the calendar first.",
      "Everyone's schedule is a negotiation. Bring snacks.",
      "You are doing better than the version of you who forgot the thing.",
      "Time is a flat circle, but your 3pm is still at 3pm.",
      "Small steps. Big calendars.",
      "Perfect attendance is overrated. Mostly.",
    ],
    spicy: [
      "Your calendar called. It's sick of your shit.",
      "Today's forecast: shit, with a chance of meetings.",
      "Put it on the calendar or shut the fuck up about forgetting it.",
      "You can't say 'I forgot' when it's literally written down, you absolute goblin.",
      "Be where you said you'd be, you magnificent bastard.",
      "Today is brought to you by caffeine and questionable decisions.",
      "Another day, another thing you swore you'd remember.",
      "Adulting: because nobody's coming to remind you. Except this thing. You're welcome.",
      "Fuck it, schedule a nap.",
      "Every 'quick call' is a goddamn lie.",
      "You're not behind. Everyone else is just lying about it.",
      "Time management is just guilt with a calendar.",
      "Your future self is going to be pissed if you don't write this down.",
      "Whoever invented the 8am appointment can go to hell.",
      "Check the time zone before you call, you beautiful disaster.",
      "Procrastination is just time-traveling to when you'll give a shit.",
      "No, you can't 'just wing it.' Look at the calendar.",
      "Rise and shine, motherfucker. You've got stuff.",
      "Today's goal: don't be a disaster in public.",
      "Heaven help the bastard who double-booked.",
      "Somewhere, a sundial is laughing at your time management.",
      "This calendar is the only reason you two function.",
      "Coffee first. Then the bullshit.",
      "If you're going to be late, at least be interesting about it.",
      "The dentist doesn't care about your excuses either.",
      "Make today your bitch. Or at least arrive on time.",
      "Be nice to the person at the front desk. They know where you live.",
      "Sober thought: it's on the calendar. Drunk thought: it's still on the calendar.",
      "Crushing it, one barely-on-time appointment at a time.",
      "Be the calm in the clusterfuck.",
    ],
  },
  empty: {
    clean: [
      "Nothing planned today. Enjoy it, or be suspicious.",
      "A blank day. Rare. Precious. Don't waste it on laundry.",
      "Free day detected. Choose your adventure.",
      "Open calendar, open possibilities, open couch.",
    ],
    spicy: [
      "Nothing planned. Suspiciously fucking quiet.",
      "Free day. Don't you dare fill it with chores.",
      "Zero appointments. Time to be a shameless slob.",
      "An empty calendar: the rarest, most bullshit-free zone there is.",
    ],
  },
  busy: {
    clean: [
      "Busy day. Pace yourself and eat something.",
      "Look at you with a full day. Deep breaths.",
      "Packed schedule. You've got this. Snacks help.",
    ],
    spicy: [
      "Holy shit, that's a lot of stuff today.",
      "Today's schedule is a goddamn marathon. Wear sneakers.",
      "Busy as hell today. Hydrate, you beautiful disaster.",
      "Packed day. Caffeinate and bulldoze it.",
    ],
  },
  friday: {
    clean: ["It's Friday. You made it.", "Friday: the best day to be only mostly productive.", "Almost there. Weekend is loading."],
    spicy: ["Fucking Friday. Hold on a little longer.", "It's Friday. Lower your standards and enjoy it.", "Friday. Pretend you're working."],
  },
  monday: {
    clean: ["Monday. Gentle start, strong coffee.", "New week, same you, better plans.", "Monday is just Sunday's problem child."],
    spicy: ["Monday. Fuck it, let's go.", "Monday: the sequel nobody asked for.", "It's Monday. Coffee, then violence. Mild violence."],
  },
  weekend: {
    clean: ["It's the weekend. Schedule less, live more.", "Weekend mode: ambition disabled.", "Rest day. Hydrate and hug someone."],
    spicy: ["Weekend. Do as little bullshit as possible.", "It's the weekend. Pants are optional.", "Weekend: the only appropriate time to be a menace."],
  },
  soon: {
    clean: [
      "{title} starts in {mins} min. Shoes on.",
      "Heads up: {title} in {mins} minutes.",
      "{mins} minutes until {title}. Plenty of time to be slightly late.",
    ],
    spicy: [
      "{title} in {mins} minutes. Get your shit together.",
      "{mins} min until {title}. Move your ass.",
      "{title} starts in {mins}. Pants. Check for pants.",
    ],
  },
};
