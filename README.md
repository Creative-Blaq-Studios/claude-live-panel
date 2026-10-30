# Live panel for Claude Code

The Live panel is a side panel for Claude Code. It shows what Claude does while it works. You do not have to read long chat output.

The panel gives you an overview first. Hold the pointer on an item or click it to see more details.

The panel works in the Claude Code desktop app, in the Claude Code extension for VS Code and in the terminal. In VS Code, the panel shows one filled button for the main action. The other buttons are quiet, so the main action is easy to find.

If a surface cannot show the panel, the `/live summary` and `/live pause` commands write the text in the chat.

Refer to [CHANGELOG.md](CHANGELOG.md) for the changes in each version.

## What the panel shows

| Part | What it shows |
| --- | --- |
| Status | One word that tells you the status: Needs you, Failed, Finished, Slow, On track, Working or Ready. Next to it, push Light or Dark to change the look of the panel. |
| Model and effort | The model that does the work, the name of the task and the effort level. Use the Effort menu to change the level. |
| Questions | The questions that Claude asks you. When there are several, each question has a tab. Push an answer button or type an answer, then push Send answers. The card closes by itself when you answer in the chat, or when Claude works again in a later turn. |
| Turn dial | The time of Claude's current turn, in the center of a dial. The arc shows how much of the estimated time is used, and the text under the time shows the time left. Under the dial, the card shows how much of the task is done, the number of steps done and the number of files changed. Push Pause to stop Claude and save a checkpoint, Stop to stop Claude, or Save to save a checkpoint and continue. |
| Session and Next auto-save | Two tiles. Session shows how long the session has run and when it started. Next auto-save shows when the panel saves the next checkpoint by itself. |
| Now | A bar with one part for each step, the current step with its timer, what Claude does now, Claude's latest update and the two updates before it, and the next step. A short update in Claude's words comes when the step changes, or about one time each minute. |
| Running in the background | Each helper and command that Claude started in the background, with a timer and its latest action. The small ring turns one time each minute while the work continues. When Claude's turn ends but this work continues, the panel shows Waiting on background work. |
| Steps | A folding section that is open at first. Each step of the task with the time it took. |
| Checkpoints | A folding section. Push Pause and save checkpoint to stop Claude and save the status. The checkpoint has a short recap and a snapshot of the panel. Push Continue from here to start again from it. The panel also saves checkpoints by itself. Use the Auto-save menu to set how often. |
| Where Claude worked | A folding section. The files that Claude created, edited or read. Click a file to see the actions on that file. |
| Activity | A folding section. A bar that shows how Claude used the last 10 minutes, and the latest actions. Click an action to see the full command or file, and the result or the error. |
| Recap | When Claude stops, the panel can write a recap. Select Summary, What changed or What's next. The recap uses ASD-STE100 Simplified Technical English. Push Copy to copy it, or push Open full view to read it in a tab. |
| Message box | Type a message to Claude. |

Each folding section is a card with one line: an arrow, the name and a summary, for example "▸ Checkpoints · Last #2 at 00:15 · Auto". Click the line to open or close the section. The arrow is ▾ and the outline is clay when the section is open.

### Light and dark

The panel has a light look and a dark look for its cards: the turn dial, the Session and Next auto-save tiles, Now and Running in the background. At first, the panel uses the look that matches your Claude Code theme setting. Push Light or Dark at the top of the panel to change it. The panel keeps your choice for all sessions.

The buttons, menus and the message box always sit outside the cards, on the background of the app, so you can read them with either look.

In the terminal, the panel uses the colors of your terminal theme.

Hold the pointer on a part of a bar to see more data.

## Checkpoints and recaps

A checkpoint that you save divides the session into sections. After it, a recap tells only about the work after that checkpoint. Push Whole session to get a recap of all of the session.

The panel keeps the checkpoints for each project. When you start a new session in the same project, the panel shows the last checkpoint. Push Continue from here to continue the work.

### Session time

The Session tile shows when the session started and how long it has run. The time includes breaks. When you resume a session, the time counts from the first start of that session. After `/clear`, the time starts again. When the session started on a different day, the date shows too.

### Automatic checkpoints

You do not have to save each checkpoint yourself. The panel saves a checkpoint by itself:

- Every 30 minutes, if Claude did work after the last checkpoint. When there is no new work, the panel does not save a checkpoint.
- When all of the steps in Claude's task list are done.

An automatic checkpoint has the label Auto. It tells about all of the work after the last checkpoint that you saved. Each new automatic checkpoint replaces the automatic checkpoint before it, so the list stays short. When you save a checkpoint, it replaces the automatic checkpoints before it. Automatic checkpoints do not divide the session into sections.

Use the Auto-save menu in the Checkpoints part of the panel to set the time: every 15 minutes, 30 minutes, hour or 2 hours, or off. You can also type `/live autosave 1h`. The panel keeps your choice for all sessions.

Each checkpoint recap is one request to the model, the same as a checkpoint that you save. If the recap fails, the panel does not keep that automatic checkpoint. The checkpoint before it stays.

### Decide later

Sometimes Claude asks a question that you do not want to answer now. For example, when a plan is finished, Claude can ask if the plan must be carried out with subagents or in the session. Push Decide later · save checkpoint in the question card. The panel saves a checkpoint that keeps the question and its options.

When you come back, in the same session or in a new session, the checkpoint shows the decision. Push Continue with and the option that you select. Claude continues from the checkpoint with your choice. Push Continue and ask me again to see the question again.

## Where the panel keeps its data

The panel keeps its data in one JSON file on your computer: `~/.claude/plugins/store/live-view_<name>.json`. Claude Code makes this file for the panel. Only your user account can read it. The file is not encrypted.

The file holds:

- Your settings, for example the effort level and the Auto-save time.
- Up to 10 checkpoints for each project. Each checkpoint is about 1 to 2 KB. It has the recap, the step names, the names of the changed files and any open decision. It does not have the contents of your files.

All of the file can have up to 4 MB. Type `/live checkpoints` to see how much it uses.

The panel cleans up the file one time each day, when a session starts:

- It removes saved checkpoints that are older than 30 days. A checkpoint with an open decision stays until you continue from it.
- It removes the checkpoints of a project folder that you deleted.

Type `/live checkpoints clear` to delete the saved checkpoints of the project now.

The plan, the actions and Claude's updates are not saved in the file. The panel forgets them when the session ends.

To write a recap, the panel sends one request to the model with the conversation, the same as the chat does. The daily version check gets the version number from GitHub. It does not send your data.

A copy of the panel that you load from a folder with `--plugin-dir` has a different file. Its checkpoints do not show in the installed panel.

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
| `/live autosave 30m` | Sets how often the panel saves a checkpoint by itself. Use a time from `10m` to `8h`, for example `1h`, or `off`. |
| `/live checkpoints` | Tells how many checkpoints are saved for the project, and how much space the data of the panel uses. |
| `/live checkpoints clear` | Deletes the saved checkpoints of the project. |
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
| `/live update` | Gets the newest version of the panel from GitHub. |
| `/live version` | Shows the version of the panel, and tells you if a newer version is available. |

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

## Update the panel

Type `/live update`. The panel gets the newest version from GitHub. Then type `/reload-plugins`, or start a new session, to use the new version.

One time each day, the panel looks for a newer version on GitHub. When there is a newer version, a message tells you.

If you loaded the panel from a local folder, `/live update` does not change the folder. Get the latest files from GitHub, for example with `git pull`.

You can also update the panel in a terminal with these commands:

```
claude plugin marketplace update claude-live-panel
claude plugin update live-view@claude-live-panel
```

## Remove the panel

1. In a terminal session, type `/plugin`.
2. Select live-view.
3. Select Uninstall.

## License

The panel uses the MIT License. Refer to the LICENSE file.
