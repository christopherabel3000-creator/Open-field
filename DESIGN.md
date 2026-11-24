# Open Field — Design Document

An audio football game. You call the plays and then play them live: you carry the ball on runs, you throw the passes, and on defense you play a linebacker trying to make the tackle. Everything is heard, not seen: where defenders are, how close, which receiver is open, where the ball is going.

Built in plain HTML, CSS and JavaScript. Playable in a browser (GitHub Pages) and later wrapped as an iPhone app for the App Store, the same way as Friday to Sunday, Shardkin and Hidden Ranks. All sounds are synthesized in code for now.

---

## 1. Core decisions (settled)

| Topic | Decision |
|---|---|
| Kind of game | Its own release, separate from Gridiron Duel and Friday to Sunday |
| Control | Medium: you call the play, then steer the ball carrier on runs, time passes to receivers by ear, and steer one defender on defense |
| Platforms | Both: keyboard on computer (JAWS in forms mode), direct gestures on iPhone (not VoiceOver gestures) |
| Opponent | Computer opponent first. Online play with a friend later |
| Defense | Call the defense, then play one linebacker: chase the ball carrier and tackle, or break on the ball |
| Game length | Adjustable quarter length: 2, 3, 5, 8, 10 or 15 minutes |
| Kicks | Punts, field goals, extra points and kickoffs are simulated after they are called |

---

## 2. How it sounds

You hear the field from where you stand, in 3D sound (best with headphones). Closer players are louder and crisper; far ones are softer, muffled and carry more stadium echo.

| Sound | Meaning |
|---|---|
| Two huts, then a thud | The cadence and the snap |
| Clatter of pads in one spot | A defender tied up with a blocker |
| Footsteps coming at you | A free defender |
| Grunt and rattling gear | A defender about to hit you: the moment to juke |
| Soft high blip | Points toward open field (can be turned off) |
| Quick ticks on one side | The sideline is close on that side |
| Repeating two-note call, left ear, both ears or right ear | A receiver is open. Left is the lowest pitch, middle in between, right highest |
| Rising tone, then a ticking beacon (defense) | Where a thrown ball will land. Higher pitch when you are lined up; faster ticks as it arrives |
| Bright, quick cleats (defense) | The ball carrier |
| Rushing spiral | The ball in the air |
| Two quick clicks (defense) | The ball carrier is in reach |
| Crowd | Rises with big plays and near the end zone |

---

## 3. Calling a play

Between snaps the game reads the play list one item at a time. The list starts on your last call.

- Keyboard: up/down (or left/right) arrows move, Enter or Space picks, 1 to 6 pick a play directly.
- Phone: swipe left/right to move, double tap to pick.
- S or swipe up: status. R or swipe down: repeat. Escape, P or two-finger tap: pause.

Offense: run left, run up the middle, run right, short pass, medium pass, deep pass. Fourth down adds punt and field goal. Late in a half: field goal on any down, timeout, kneel down.

Defense: run defense, balanced, pass defense, blitz.

What the defense calls matters:

| Call | Against the run | Against the pass |
|---|---|---|
| Run defense | Extra man in the box, blocks shed faster | Receivers open more often |
| Balanced | Normal | Normal |
| Pass defense | Lighter box, more room to run | Fewer and shorter open windows, slower rush |
| Blitz | Big losses or big gains | Fast rush and more sacks, but short throws beat it |

---

## 4. Playing the snap

### Running
You start behind the line and run toward the hole on your own. Left/right cut about two yards (hold to keep drifting). Space or tap jukes: time it as a tackler arrives. It works most of the time and needs a moment to recover. Up or swipe up is a burst of speed, once per play. Tacklers can be broken now and then, more often when you are bursting, and less often when two arrive together.

### Passing
Three receivers (left, middle, right) each get open at different times, depending on route depth and the coverage. Throw with left, up or right (arrow or swipe); down throws it away. An open receiver is a much safer throw than a covered one. Wait too long and the rush gets you. After a catch you run with the ball using the running controls.

### Defense
You play a linebacker facing the offense, so their left is your right. You move with the play up and down the field on your own and steer left and right. On runs, follow the carrier's footsteps and tackle when you hear the two clicks. On passes, slide toward the ball in the air and press as it arrives to break it up or intercept. If you do not make the play, the rest of the defense plays it out.

---

## 5. Rules

- NFL-style: four downs to gain ten yards, touchdowns 6, field goals 3, safeties 2, extra point or two-point try after a touchdown.
- The clock starts on the snap and keeps running after plays that stay in bounds, about 28 seconds between snaps (12 seconds in the last two minutes of a half when trailing or tied, 38 when ahead). It stops for incompletions, scores, turnovers, timeouts, and running out of bounds in the last two minutes of a half.
- Three timeouts per half. Two-minute warning in the second and fourth quarters (for quarters of 5 minutes or longer).
- Kickoff touchbacks at the 30. Punt and interception touchbacks at the 20. A missed field goal goes over at the spot of the kick, or the 20.
- Tied after four quarters: overtime, and the next score wins.

---

## 6. Later

- Online play with a friend through Firebase, in Open Field's own section of the database.
- More plays: draws, screens, play action, option routes.
- Named teams and seasons.
- Penalties.
- Recorded sounds in place of the synthesized ones.
- iPhone app for the App Store.
