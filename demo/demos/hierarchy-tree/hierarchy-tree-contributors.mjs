import { RelayCommand } from '@pragmatic-tech-ai/mural/runtime';
import { NodeContribution, } from '@pragmatic-tech-ai/mural/framework';
import { HierarchyTreeDemoKeys } from './hierarchy-tree-keys.mjs';
// Two small contributors feeding the demo's `Hierarchy { }` DSL block
// (hierarchy-tree.module.mu): NotebookSectionsContributor fans out the
// root's children (one level of "sections"); NotebookNotesContributor fans
// out each section's children ("notes"), reading which section it's
// realizing off the parent HierarchyItem's own ExtObject — the interning
// identity Hierarchy keys keyed (NodeContribution) children by. Both also
// dispatch the couple of nested right-click actions the module's
// Hierarchy {} block declares for their node kind: plain Caption mutations
// / a console log — the "log / mutate the caption" shape the task brief
// asks for. There is no backing document model here; this is a demo, not a
// real explorer.
export class NotebookSectionsContributor {
    static StarCommandId = 'hierarchy-tree-demo.section.star';
    static ClearStarsCommandId = 'hierarchy-tree-demo.section.clearStars';
    static StarSuffix = ' ★'; // ' ★'
    static IdeasSection = 'ideas';
    static TodoSection = 'todo';
    ParentKeys = [HierarchyTreeDemoKeys.NotebookRoot];
    Order = 0;
    // Every contributor ctor takes the provider, by convention (see
    // compiler.ts's compileServiceEntry comment) — this one has no
    // collaborator to resolve from it.
    constructor(_provider) {
    }
    Contribute(_parent) {
        const nodes = [
            { Key: HierarchyTreeDemoKeys.Section, ExtObject: NotebookSectionsContributor.IdeasSection, Caption: 'Ideas', IsExpandable: true },
            { Key: HierarchyTreeDemoKeys.Section, ExtObject: NotebookSectionsContributor.TodoSection, Caption: 'To-Do', IsExpandable: true },
        ];
        return new NodeContribution(nodes);
    }
    Resolve(commandId, context) {
        const anchor = context.Anchor;
        switch (commandId) {
            case NotebookSectionsContributor.StarCommandId:
                return new RelayCommand(() => {
                    anchor.Caption = anchor.Caption + NotebookSectionsContributor.StarSuffix;
                });
            case NotebookSectionsContributor.ClearStarsCommandId:
                return new RelayCommand(() => {
                    anchor.Caption = anchor.Caption.split(NotebookSectionsContributor.StarSuffix).join('');
                });
            default:
                return undefined;
        }
    }
}
export class NotebookNotesContributor {
    static ToggleDoneCommandId = 'hierarchy-tree-demo.note.toggleDone';
    static LogCommandId = 'hierarchy-tree-demo.note.logToConsole';
    static DonePrefix = '✓ '; // '✓ '
    static LogLabel = '[hierarchy-tree demo] note:';
    static SectionIdSeparator = ':';
    static NotesBySection = new Map([
        ['ideas', ['Brainstorm demo content', 'Sketch tree icons']],
        ['todo', ['Write the Hierarchy {} module', 'Wire the default .Behaviors: bundle']],
    ]);
    ParentKeys = [HierarchyTreeDemoKeys.Section];
    Order = 0;
    constructor(_provider) {
    }
    Contribute(parent) {
        const section = parent.ExtObject;
        const notes = NotebookNotesContributor.NotesBySection.get(section) ?? [];
        const nodes = notes.map((text, index) => ({
            Key: HierarchyTreeDemoKeys.Note,
            ExtObject: section + NotebookNotesContributor.SectionIdSeparator + index,
            Caption: text,
        }));
        return new NodeContribution(nodes);
    }
    Resolve(commandId, context) {
        const anchor = context.Anchor;
        switch (commandId) {
            case NotebookNotesContributor.ToggleDoneCommandId:
                return new RelayCommand(() => {
                    anchor.Caption = anchor.Caption.startsWith(NotebookNotesContributor.DonePrefix)
                        ? anchor.Caption.slice(NotebookNotesContributor.DonePrefix.length)
                        : NotebookNotesContributor.DonePrefix + anchor.Caption;
                });
            case NotebookNotesContributor.LogCommandId:
                return new RelayCommand(() => {
                    console.log(NotebookNotesContributor.LogLabel, anchor.Caption);
                });
            default:
                return undefined;
        }
    }
}
