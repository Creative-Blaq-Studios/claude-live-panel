# Changelog

This file tells about the changes in each version of the Live panel.

## 1.8.2 (2026-10-31)

### Fixed

- Steps did not open at first after an update from 1.8.0. Now it does.
- After a turn, the ring was full even when not all of the steps were done. Now the ring shows the part of the steps that is done.
- After a turn, the dial card showed the current step, for example "Step 4 of 4". Now it shows when the turn ended.
- The dial and the status line showed different times for the same turn, for example 0:06 and 7s. Now both round to the nearest second.
- "Task finished" repeated the status line. Now that line shows only when background work continues.

## 1.8.1 (2026-10-31)

### Fixed

- With the light look in a dark app, or the dark look in a light app, some parts were not visible: the Light and Dark buttons, the Effort menu, Pause and Save, the answer buttons, the folding sections and the message box. The panel now paints only its cards, and the buttons, menus and the message box sit outside the cards, on the background of the app.

### Changed

- The cards have more space inside them and between them.
- The dial card also shows how much of the task is done, the number of steps done and the number of files changed.
- Steps is open at first.
- The Now card shows what Claude does now, and Claude's two updates before the latest one.

## 1.8.0 (2026-10-31)

### Added

- A new design: the turn dial. The time of Claude's current turn is in the center of a dial, and the arc shows how much of the estimated time is used. Under the dial, push Pause, Stop or Save.
- Light and dark looks. At first, the panel uses the look that matches your Claude Code theme setting. Push Light or Dark at the top of the panel to change it. The panel keeps your choice for all sessions. In the terminal, the panel uses the colors of your terminal theme.
- The Session and Next auto-save tiles. Next auto-save tells when the panel saves the next checkpoint by itself.
- A small ring for each task in the background. It turns one time each minute while the work continues.

### Changed

- Steps, Checkpoints, Where Claude worked and Activity are folding sections. Each one shows one line with a summary. Click the line to open the section.
- The Now card holds the step bar, the current step with its timer, Claude's update in plain words and the next step.
- The session time moved from the top line to the Session tile.
- Stop Claude moved from the message box to the dial.
- A checkpoint row tells "1 file changed", not "1 files changed".

## 1.7.0 (2026-10-31)

### Added

- Session time. The top of the panel shows when the session started and how long it has run, for example "Session · started 09:14 · 2h 31m". It shows in all states of the panel. A resumed session counts from its first start. After `/clear`, the time starts again.
- Automatic checkpoints. The panel saves a checkpoint by itself every 30 minutes, if Claude did work after the last checkpoint. It also saves one when all of the steps in Claude's task list are done. An automatic checkpoint has the label Auto, and each new one replaces the one before it.
- The Auto-save menu in the Checkpoints part of the panel, and the `/live autosave` command. Set the time from 10 minutes to 8 hours, or set it to off.
- The `/live checkpoints` command. It tells how many checkpoints are saved for the project, and how much space the data of the panel uses. `/live checkpoints clear` deletes the saved checkpoints of the project.
- Cleanup. One time each day, the panel removes saved checkpoints older than 30 days, and the checkpoints of project folders that are not there. A checkpoint with an open decision stays until you continue from it.
- When the panel cannot keep a checkpoint for later sessions, a message tells you.

### Changed

- Recaps count from the last checkpoint that you saved. Automatic checkpoints do not divide the session into sections.
- When you save a checkpoint, it replaces the automatic checkpoints before it.
- When you continue from a checkpoint with an open decision, the checkpoint no longer keeps the decision open.
- `/live` also tells when the session started and how long it has run.

## 1.6.0 (2026-10-30)

### Added

- Running in the background. The panel shows each helper and each command that Claude starts in the background. Each one has a timer and its latest action, with how long ago that action was and the number of actions. This shows that the work continues while Claude waits. When a task has no new action for 5 minutes, its line changes color.
- When Claude's turn ends but background work continues, the panel shows "Waiting on background work", not "Task finished".
- A finished background task stays in the list for 15 minutes with its result: Finished, Failed or Stopped.

## 1.5.0 (2026-10-27)

### Added

- Decide later. The question card has a Decide later · save checkpoint button. The checkpoint keeps the question and its options. In the same session or in a new session, push Continue with and an option to continue with that choice.

### Changed

- When Claude needs you, the panel shows one reply box, in the question card. The second message box is not shown.
- When Claude needs you, the top of the panel shows how long Claude has waited, not how long the task took.
- The question card shows the label of the question as its title, not "Claude needs you" again.
- The progress bar and the activity bar fill the width of the panel.
- When Claude waits or is done, the timer of the current step is not shown.
- Show what Claude did has a marker and a row of its own.

## 1.4.0 (2026-10-27)

### Added

- The `/live update` command. It gets the newest version of the panel from GitHub.
- The `/live version` command. It shows the version of the panel, and tells you if a newer version is available.
- One time each day, the panel looks for a newer version on GitHub. When there is a newer version, a message tells you.

## 1.3.0 (2026-10-27)

### Added

- Questions with tabs. When Claude asks several questions, each question has a tab. A check mark shows the questions that have an answer. The footer shows how many questions have an answer, and the Send answers button sends all of the answers together.
- A progress ring. The ring shows how much of the task is done. Next to the ring, the panel shows the percentage, the number of steps, the time spent, the time left and the number of files changed.
- Now and Then lines. These lines show the current step with its timer, and the next step.
- Claude's updates. The panel tells you what Claude does now in plain words, for example "Running the tests" or "Writing tests". When the step changes, or about one time each minute, Claude writes a short update in its own words. The updates do not name files or commands.
- The `/live narrate off` command stops the short updates. Use `/live narrate on` to start them again.
- A Steps list. Each step shows the time it took, or the time it runs now.

### Changed

- The status at the top of the panel is larger, and the time spent shows on the right. When Claude stops, the panel shows how long the task took.
- Short answer options for a question show in a row. Long options, and options with a description, show in a column.
- The "(Recommended)" text in an answer becomes a "Recommended" label.
- The button that moves the questions to the usual dialog is now in the question card.
- In VS Code, only the main action is a filled button. The other buttons are quiet.
- When Claude works, the panel shows the progress, the updates and the steps first. Where Claude worked and Activity open when you push the activity button.
- The legend in Where Claude worked is shorter.

### Removed

- The help text below the actions list.

## 1.2.0 (2026-10-17)

### Changed

- Where a surface cannot show the panel, recaps and checkpoints show in the chat.

## 1.1.0 (2026-10-17)

### Added

- Checkpoints. Push Pause and save checkpoint to stop Claude and save the status.
- Section recaps. After a checkpoint, a recap tells only about the work after that checkpoint. Push Whole session to get a recap of all of the session.
- Continue from a checkpoint in a new session in the same project.
- Recaps show as wrapped text, and the full view shows the recap in a tab.

## 1.0.0 (2026-10-17)

### Added

- The Live panel: the health signal, the model and effort level, the plan, the activity and the questions from Claude.
- Recaps: Summary, What changed and What's next, in ASD-STE100 Simplified Technical English.
- The Where Claude worked view.
- The progress display for a script from a JSON progress file.
