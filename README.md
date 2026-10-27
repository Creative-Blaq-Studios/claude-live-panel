# Live panel for Claude Code

The Live panel is a side panel for Claude Code. It shows what Claude does while it works. You do not have to read long chat output.

The panel gives you an overview first. Hold the pointer on an item or click it to see more details.

The panel works in the Claude Code desktop app, in the Claude Code extension for VS Code and in the terminal. In VS Code, the panel shows one filled button for the main action. The other buttons are quiet, so the main action is easy to find.

If a surface cannot show the panel, the `/live summary` and `/live pause` commands write the text in the chat.

Refer to [CHANGELOG.md](CHANGELOG.md) for the changes in each version.

## What the panel shows

| Part | What it shows |
| --- | --- |
| Health signal | One word that tells you the status: Needs you, Failed, Finished, Slow, On track, Working or Ready. |
| Model and effort | The model that does the work and its effort level. Use the Effort menu to change the level. |
| Questions | The questions that Claude asks you. When there are several, each question has a tab. Push an answer button or type an answer, then push Send answers. |
| Progress | A ring that shows how much of the task is done. It also shows the time spent, the time left, the current step and the next step. |
| Claude's updates | What Claude does now, in plain words. A short update in Claude's words comes when the step changes, or about one time each minute. |
| Steps | Each step of the task with the time it took. |
| Where Claude worked | The files that Claude created, edited or read. Click a file to see the actions on that file. |
| Activity | A bar that shows how Claude used the last 10 minutes. It also shows the latest actions. |
| Action details | Click an action to see the full command or file. You also see the result or the error. |
| Recap | When Claude stops, the panel can write a recap. Select Summary, What changed or What's next. The recap uses ASD-STE100 Simplified Technical English. Push Copy to copy it, or push Open full view to read it in a tab. |
| Checkpoints | Push Pause and save checkpoint to stop Claude and save the status. The checkpoint has a short recap and a snapshot of the panel. Push Continue from here to start again from it. |
| Message box | Type a message to Claude. Push Stop Claude to stop the work. |

Hold the pointer on a part of a bar to see more data.

## Checkpoints and recaps

A checkpoint divides the session into sections. After a checkpoint, a recap tells only about the work after that checkpoint. Push Whole session to get a recap of all of the session.

The panel keeps the checkpoints for each project. When you start a new session in the same project, the panel shows the last checkpoint. Push Continue from here to continue the work.

## Requirements

You must have Claude Code version 2.1.299 or later.

The panel uses the Claude Code mod API. This API can change between releases.

## Install the panel

### Install in the terminal

1. Start Claude Code in a terminal.
2. Type this command:

   ```
   /plugin install live-view --marketplace Creative-Blaq-Studios/claude-live-panel
   ```

3. When Claude Code asks you to add the marketplace, type `y`.
4. Select the user scope.

The panel loads in each new session.

### Install in the desktop app

1. Click the plus button next to the message box.
2. Click Plugins.
3. Click Add marketplace.
4. Type `Creative-Blaq-Studios/claude-live-panel`.
5. Click Add plugin, then select live-view.

### Load from a local folder

Use this procedure to test a copy of the files.

1. Download or clone this repository to a folder.
2. Start Claude Code with this command:

   ```
   claude --plugin-dir <folder>
   ```

## Use the panel

The panel opens when a session starts. If you close it, type `/live` to open it again.

| Command | Result |
| --- | --- |
| `/live` | Opens the panel. |
| `/live pause` | Stops Claude and saves a checkpoint. |
| `/live checkpoint` | Saves a checkpoint and does not stop Claude. |
| `/live effort high` | Sets the effort level for the next steps. Use `low`, `medium`, `high`, `xhigh` or `max`. |
| `/live effort session` | Uses the effort level of the session again. |
| `/live summary` | Writes a summary of the session. |
| `/live summary changes` | Writes a list of the changes in the session. |
| `/live summary next` | Writes a list of the work that is left and the decisions for you. |
| `/live summary all` | Writes a summary of all of the session. You can add `all` to the other recap commands too. |
| `/live summaries off` | Stops the recap offer at the end of each task. Use `on` to start it again. |
| `/live narrate off` | Stops the short updates from Claude in plain words. Use `on` to start them again. |
| `/live watch <file>` | Shows the progress of a script from a progress file. |
| `/live unwatch` | Stops the progress file display. |
| `/live questions panel` | Shows the questions from Claude in the panel. This is the default. |
| `/live questions dialog` | Shows the questions from Claude in the usual dialog. |
| `/live autoopen off` | Stops the panel from opening when a session starts. Use `on` to start it again. |

The panel keeps your settings for all sessions.

## Show the progress of a script

A script can write a JSON progress file. The panel reads the file one time each second.

```json
{
  "title": "Test run",
  "steps": [
    { "title": "Build the app", "status": "done" },
    { "title": "Run the tests", "status": "active" },
    { "title": "Send the report", "status": "pending" }
  ]
}
```

The `status` value must be `done`, `active`, `pending` or `failed`.

Type `/live watch <path to the file>` to show the progress.

## Remove the panel

1. In a terminal session, type `/plugin`.
2. Select live-view.
3. Select Uninstall.

## License

The panel uses the MIT License. Refer to the LICENSE file.
