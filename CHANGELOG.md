# Changelog

This file tells about the changes in each version of the Live panel.

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
