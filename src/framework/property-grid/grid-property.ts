import { MuralBase } from '../../runtime/index.js';

export enum PropertyKind {
    Text = 'text',
    MultilineText = 'multiline',
    Number = 'number',
    Boolean = 'boolean',
    Enum = 'enum',
    Color = 'color',
}

export interface GridPropertyOptions {
    displayName?: string;
    category?: string;
    readOnly?: boolean;
    description?: string;
    enumOptions?: readonly unknown[];
    min?: number;
    max?: number;
    editorTemplateKey?: string;
}

export class GridProperty {
    readonly Name: string;
    readonly DisplayName: string;
    readonly Category: string;
    readonly Kind: PropertyKind;
    readonly IsReadOnly: boolean;
    readonly Description: string | undefined;
    readonly EnumOptions: readonly unknown[] | undefined;
    readonly Min: number | undefined;
    readonly Max: number | undefined;
    readonly EditorTemplateKey: string | undefined;

    private constructor(name: string, kind: PropertyKind, opts: GridPropertyOptions = {}) {
        this.Name = name;
        this.Kind = kind;
        this.DisplayName = opts.displayName ?? name;
        this.Category = opts.category ?? 'General';
        this.IsReadOnly = opts.readOnly ?? false;
        this.Description = opts.description;
        this.EnumOptions = opts.enumOptions;
        this.Min = opts.min;
        this.Max = opts.max;
        this.EditorTemplateKey = opts.editorTemplateKey;
    }

    static text(name: string, opts?: GridPropertyOptions): GridProperty {
        return new GridProperty(name, PropertyKind.Text, opts);
    }

    static multiline(name: string, opts?: GridPropertyOptions): GridProperty {
        return new GridProperty(name, PropertyKind.MultilineText, opts);
    }

    static number(name: string, opts?: GridPropertyOptions): GridProperty {
        return new GridProperty(name, PropertyKind.Number, opts);
    }

    static bool(name: string, opts?: GridPropertyOptions): GridProperty {
        return new GridProperty(name, PropertyKind.Boolean, opts);
    }

    static enumOf(name: string, options: readonly unknown[], opts?: GridPropertyOptions): GridProperty {
        return new GridProperty(name, PropertyKind.Enum, { ...opts, enumOptions: options });
    }

    static color(name: string, opts?: GridPropertyOptions): GridProperty {
        return new GridProperty(name, PropertyKind.Color, opts);
    }

    static describeDpTarget(target: MuralBase, overrides?: ReadonlyMap<string, GridProperty>): GridProperty[] {
        const result: GridProperty[] = [];
        for (const descriptor of MuralBase.EnumerateProperties(target.constructor as Function)) {
            const override = overrides?.get(descriptor.Name);
            if (override !== undefined) {
                result.push(override);
                continue;
            }
            const defaultVal = descriptor.DefaultValue;
            let kind: PropertyKind;
            if (typeof defaultVal === 'boolean') {
                kind = PropertyKind.Boolean;
            } else if (typeof defaultVal === 'number') {
                kind = PropertyKind.Number;
            } else {
                kind = PropertyKind.Text;
            }
            result.push(new GridProperty(descriptor.Name, kind, { readOnly: descriptor.IsReadOnly }));
        }
        return result;
    }
}
