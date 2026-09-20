import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MapPropertyBag, type PropertyAccessor } from '@pragmatic-tech-ai/todl-runtime';
import { GridProperty } from '../grid-property.js';
import { PropertyItem, PropertyCategory } from '../property-item.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRwBag(name: string, initial: unknown): MapPropertyBag {
    let stored = initial;
    const accessors = new Map<string, PropertyAccessor>([
        [
            name,
            {
                id: () => name,
                displayName: () => name,
                get: () => stored,
                set: (v) => {
                    stored = v;
                },
            },
        ],
    ]);
    return new MapPropertyBag(accessors);
}

function makeRoBag(name: string, initial: unknown): MapPropertyBag {
    const stored = initial;
    const accessors = new Map<string, PropertyAccessor>([
        [name, { id: () => name, displayName: () => name, get: () => stored }],
    ]);
    return new MapPropertyBag(accessors);
}

// ---------------------------------------------------------------------------
// PropertyItem — Value get/set round-trips
// ---------------------------------------------------------------------------

describe('PropertyItem — Value get/set round-trip', () => {
    test('Value getter returns the current bag value', () => {
        const bag = makeRwBag('title', 'hello');
        const desc = GridProperty.text('title');
        const item = new PropertyItem(desc, bag);
        assert.equal(item.Value, 'hello');
        item.dispose();
    });

    test('setting Value updates the bag', () => {
        const bag = makeRwBag('title', 'hello');
        const desc = GridProperty.text('title');
        const item = new PropertyItem(desc, bag);
        item.Value = 'world';
        assert.equal(item.Value, 'world');
        item.dispose();
    });

    test('Value reflects subsequent bag changes after construction', () => {
        const bag = makeRwBag('count', 0);
        const desc = GridProperty.number('count');
        const item = new PropertyItem(desc, bag);
        bag.SetValue('count', 42);
        assert.equal(item.Value, 42);
        item.dispose();
    });
});

// ---------------------------------------------------------------------------
// PropertyItem — external bag change raises PropertyChanged("Value")
// ---------------------------------------------------------------------------

describe('PropertyItem — external bag change raises PropertyChanged("Value")', () => {
    test('SetValue through the bag fires PropertyChanged("Value") on the item', () => {
        const bag = makeRwBag('x', 0);
        const desc = GridProperty.number('x');
        const item = new PropertyItem(desc, bag);

        const events: string[] = [];
        item.PropertyChanged('Value').subscribe(({ property }) => {
            events.push(property);
        });

        bag.SetValue('x', 99);
        assert.deepEqual(events, ['Value']);
        item.dispose();
    });

    test('multiple external changes raise multiple notifications', () => {
        const bag = makeRwBag('x', 0);
        const desc = GridProperty.number('x');
        const item = new PropertyItem(desc, bag);

        let count = 0;
        item.PropertyChanged('Value').subscribe(() => {
            count++;
        });

        bag.SetValue('x', 1);
        bag.SetValue('x', 2);
        bag.SetValue('x', 3);
        assert.equal(count, 3);
        item.dispose();
    });

    test('notification carries updated new value', () => {
        const bag = makeRwBag('x', 0);
        const desc = GridProperty.number('x');
        const item = new PropertyItem(desc, bag);

        let capturedNew: unknown;
        item.PropertyChanged('Value').subscribe(({ newValue }) => {
            capturedNew = newValue;
        });

        bag.SetValue('x', 77);
        assert.equal(capturedNew, 77);
        item.dispose();
    });
});

// ---------------------------------------------------------------------------
// PropertyItem — IsReadOnly
// ---------------------------------------------------------------------------

describe('PropertyItem — IsReadOnly', () => {
    test('IsReadOnly is false when neither descriptor nor bag is read-only', () => {
        const bag = makeRwBag('v', 0);
        const desc = GridProperty.number('v');
        const item = new PropertyItem(desc, bag);
        assert.equal(item.IsReadOnly, false);
        item.dispose();
    });

    test('IsReadOnly is true when the descriptor is read-only', () => {
        const bag = makeRwBag('v', 0);
        const desc = GridProperty.number('v', { readOnly: true });
        const item = new PropertyItem(desc, bag);
        assert.equal(item.IsReadOnly, true);
        item.dispose();
    });

    test('IsReadOnly is true when the bag reports read-only for the property', () => {
        const bag = makeRoBag('v', 0);
        const desc = GridProperty.number('v');
        const item = new PropertyItem(desc, bag);
        assert.equal(item.IsReadOnly, true);
        item.dispose();
    });

    test('IsReadOnly is true when both descriptor and bag are read-only', () => {
        const bag = makeRoBag('v', 0);
        const desc = GridProperty.number('v', { readOnly: true });
        const item = new PropertyItem(desc, bag);
        assert.equal(item.IsReadOnly, true);
        item.dispose();
    });
});

// ---------------------------------------------------------------------------
// PropertyItem — setting Value on a read-only item does NOT write
// ---------------------------------------------------------------------------

describe('PropertyItem — read-only guard on set Value', () => {
    test('setting Value when descriptor is read-only does not write to the bag', () => {
        let stored = 'original';
        const accessors = new Map<string, PropertyAccessor>([
            [
                'label',
                {
                    id: () => 'label',
                    displayName: () => 'label',
                    get: () => stored,
                    set: (v) => {
                        stored = v as string;
                    },
                },
            ],
        ]);
        const bag = new MapPropertyBag(accessors);
        const desc = GridProperty.text('label', { readOnly: true });
        const item = new PropertyItem(desc, bag);

        item.Value = 'changed';

        // The bag itself is writable; only the descriptor gate prevents the write
        assert.equal(stored, 'original');
        item.dispose();
    });

    test('setting Value when bag is read-only does not write to the bag', () => {
        const bag = makeRoBag('label', 'original');
        const desc = GridProperty.text('label');
        const item = new PropertyItem(desc, bag);

        // Should not throw; should silently discard
        assert.doesNotThrow(() => {
            item.Value = 'changed';
        });
        assert.equal(item.Value, 'original');
        item.dispose();
    });
});

// ---------------------------------------------------------------------------
// PropertyItem — Dispose unsubscribes (external change no longer raises)
// ---------------------------------------------------------------------------

describe('PropertyItem — Dispose unsubscribes', () => {
    test('after Dispose, an external bag change no longer raises PropertyChanged("Value")', () => {
        const bag = makeRwBag('z', 0);
        const desc = GridProperty.number('z');
        const item = new PropertyItem(desc, bag);

        let count = 0;
        item.PropertyChanged('Value').subscribe(() => {
            count++;
        });

        bag.SetValue('z', 1);
        assert.equal(count, 1);

        item.dispose();

        bag.SetValue('z', 2);
        assert.equal(count, 1, 'no more notifications after Dispose');
    });

    test('Dispose is idempotent — calling it twice does not throw', () => {
        const bag = makeRwBag('z', 0);
        const desc = GridProperty.number('z');
        const item = new PropertyItem(desc, bag);
        item.dispose();
        assert.doesNotThrow(() => {
            item.dispose();
        });
    });
});

// ---------------------------------------------------------------------------
// PropertyItem — Descriptor is stored and accessible
// ---------------------------------------------------------------------------

describe('PropertyItem — Descriptor', () => {
    test('Descriptor references the GridProperty passed at construction', () => {
        const bag = makeRwBag('name', '');
        const desc = GridProperty.text('name');
        const item = new PropertyItem(desc, bag);
        assert.strictEqual(item.Descriptor, desc);
        item.dispose();
    });
});

// ---------------------------------------------------------------------------
// PropertyCategory — basic shape
// ---------------------------------------------------------------------------

describe('PropertyCategory — Header and Items', () => {
    test('Header returns the string passed to constructor', () => {
        const cat = new PropertyCategory('General', []);
        assert.equal(cat.Header, 'General');
    });

    test('Items returns the array passed to constructor', () => {
        const bag = makeRwBag('x', 0);
        const item = new PropertyItem(GridProperty.number('x'), bag);
        const cat = new PropertyCategory('G', [item]);
        assert.deepEqual(cat.Items, [item]);
        item.dispose();
    });
});

// ---------------------------------------------------------------------------
// PropertyCategory — IsExpanded toggles and raises PropertyChanged
// ---------------------------------------------------------------------------

describe('PropertyCategory — IsExpanded reactive property', () => {
    test('IsExpanded defaults to true', () => {
        const cat = new PropertyCategory('G', []);
        assert.equal(cat.IsExpanded, true);
    });

    test('setting IsExpanded to false updates the value', () => {
        const cat = new PropertyCategory('G', []);
        cat.IsExpanded = false;
        assert.equal(cat.IsExpanded, false);
    });

    test('setting IsExpanded raises PropertyChanged("IsExpanded")', () => {
        const cat = new PropertyCategory('G', []);
        const events: string[] = [];
        cat.PropertyChanged('IsExpanded').subscribe(({ property }) => {
            events.push(property);
        });
        cat.IsExpanded = false;
        assert.deepEqual(events, ['IsExpanded']);
    });

    test('setting IsExpanded to the same value does NOT raise PropertyChanged', () => {
        const cat = new PropertyCategory('G', []);
        let count = 0;
        cat.PropertyChanged('IsExpanded').subscribe(() => {
            count++;
        });
        cat.IsExpanded = true; // same as default
        assert.equal(count, 0);
    });

    test('toggling back fires a second notification', () => {
        const cat = new PropertyCategory('G', []);
        let count = 0;
        cat.PropertyChanged('IsExpanded').subscribe(() => {
            count++;
        });
        cat.IsExpanded = false;
        cat.IsExpanded = true;
        assert.equal(count, 2);
    });

    test('notification carries old and new value', () => {
        const cat = new PropertyCategory('G', []);
        let capturedOld: unknown;
        let capturedNew: unknown;
        cat.PropertyChanged('IsExpanded').subscribe(({ oldValue, newValue }) => {
            capturedOld = oldValue;
            capturedNew = newValue;
        });
        cat.IsExpanded = false;
        assert.equal(capturedOld, true);
        assert.equal(capturedNew, false);
    });
});
