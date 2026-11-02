# Prompts

Copy-paste prompts for Claude Code, one per roadmap task, if you prefer them over the slash commands.
Use them in order. Start each new task in a fresh Claude Code conversation (`/clear`) so context stays small.

General pattern that works well:
1. Paste the task prompt.
2. Let Claude plan; answer its questions.
3. Let it implement and run tests.
4. Run `/review-task <ID>` in a new conversation before committing.
5. `git commit -m "<ID> ..."`.
