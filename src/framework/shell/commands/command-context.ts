// The dispatch context handed to ICommandDispatcher.Resolve. The base carries
// nothing surface-specific; concrete surfaces subtype it (the toolbar/main menu
// pass the active document + selection; Milestone B's HierarchyActionContext adds
// the anchor item + tree selection).
export class CommandContext
{
}
