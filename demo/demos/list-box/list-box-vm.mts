// ListBoxVM — three-pane ListBox showcase: declarative items on the
// left (markup-only), Items=[...] convenience in the middle, and an
// ItemsSource + CollectionView pane on the right whose Sort / Filter
// state is exercised through host-side click handlers.
//
// The right pane's interaction is FindName-based — the buttons,
// status TextBlock, and bound ListBox are all picked up by their
// x:name attributes from the freshly-rendered view inside
// OnViewMounted. CollectionView subscription + toggle state live on
// the VM so the demo data and behavior travel with the model.
import { type Visual, MuralBase } from '@pragmatic-tech-ai/mural/runtime';
import { SortDescription, SortDirection, TextBlock } from '@pragmatic-tech-ai/mural/basic';
import { Button } from '@pragmatic-tech-ai/mural/framework';
import {
    ListBox, ListBoxItem,
} from '@pragmatic-tech-ai/mural/framework';

interface Person { name: string; role: string; }
interface LabelledPerson extends Person { Label: string; }

const PEOPLE: readonly Person[] = [
    { name: 'Alice',   role: 'eng'    },
    { name: 'Bob',     role: 'sales'  },
    { name: 'Carla',   role: 'eng'    },
    { name: 'Daniel',  role: 'design' },
    { name: 'Ezra',    role: 'eng'    },
    { name: 'Faye',    role: 'sales'  },
    { name: 'Gus',     role: 'design' },
    { name: 'Harriet', role: 'eng'    },
];

// Display: "Name — role". ListBox's default GetContainerForItemOverride
// renders displayString(item), so passing a plain object means we
// need an ItemTemplate (or a Label/Name/Text field). Easiest: project
// the data through a label-bearing record.
function labelled(p: Person): LabelledPerson
{
    return { Label: `${p.name} — ${p.role}`, name: p.name, role: p.role };
}

export class ListBoxVM extends MuralBase
{
    OnViewMounted(view: Visual): void
    {
        const bound      = view.FindName('bound');
        const btnSort    = view.FindName('btnSort');
        const btnFilter  = view.FindName('btnFilter');
        const statusLine = view.FindName('statusLine');

        if (!(bound instanceof ListBox))        throw new Error('list-box.mu missing x:name="bound" ListBox');
        if (!(btnSort instanceof Button))       throw new Error('list-box.mu missing x:name="btnSort" Button');
        if (!(btnFilter instanceof Button))     throw new Error('list-box.mu missing x:name="btnFilter" Button');
        if (!(statusLine instanceof TextBlock)) throw new Error('list-box.mu missing x:name="statusLine"');

        // ItemsSource auto-wraps in a CollectionView (ItemsControl Tier 3).
        bound.ItemsSource = PEOPLE.map(labelled);
        // Per-row AlternationIndex available on every realized container.
        bound.AlternationCount = 2;

        const view2 = bound.View;
        if (view2 === undefined) throw new Error('ItemsSource should have created a View');

        // SortDescription / Filter receive untyped projected items; narrow
        // each to the LabelledPerson shape the source was mapped into.
        const sortAsc  = new SortDescription((d: unknown) => (d as LabelledPerson).name, SortDirection.Asc);
        const sortDesc = new SortDescription((d: unknown) => (d as LabelledPerson).name, SortDirection.Desc);
        const engFilter = (d: unknown) => (d as LabelledPerson).role === 'eng';

        let sortState:    'off' | 'asc' | 'desc'   = 'off';
        let filterState: 'off' | 'engineers'       = 'off';

        const applySort = () => {
            view2.SortDescriptions.Clear();
            if (sortState === 'asc')  view2.SortDescriptions.Add(sortAsc);
            if (sortState === 'desc') view2.SortDescriptions.Add(sortDesc);
            btnSort.Content = sortLabel();
        };
        const applyFilter = () => {
            view2.Filter = filterState === 'engineers' ? engFilter : undefined;
            btnFilter.Content = filterLabel();
        };
        const sortLabel = () => {
            const text = sortState === 'asc'  ? 'Sort A→Z'
                       : sortState === 'desc' ? 'Sort Z→A'
                       :                        'Sort off';
            const tb = new TextBlock(text);
            tb.FontSize = 11;
            return tb;
        };
        const filterLabel = () => {
            const text = filterState === 'engineers' ? 'Show all' : 'Engineers only';
            const tb = new TextBlock(text);
            tb.FontSize = 11;
            return tb;
        };
        const refreshStatus = () => {
            statusLine.Text = `${view2.Count} of ${PEOPLE.length} visible`;
        };

        btnSort.AddClickHandler(() => {
            sortState = sortState === 'off'  ? 'asc'
                      : sortState === 'asc'  ? 'desc'
                      :                        'off';
            applySort();
        });

        btnFilter.AddClickHandler(() => {
            filterState = filterState === 'off' ? 'engineers' : 'off';
            applyFilter();
            refreshStatus();
        });

        // CollectionView re-projects on Sort/Filter changes; subscribe so
        // the status line stays accurate even when something else mutates
        // the projection.
        view2.Subscribe(() => refreshStatus());

        btnSort.Content   = sortLabel();
        btnFilter.Content = filterLabel();
        refreshStatus();
    }
}

// Silence unused-import lint — ListBoxItem reference proves we depend on
// the class being available at runtime for the markup-tree containers
// the template builds via composition.
void ListBoxItem;
