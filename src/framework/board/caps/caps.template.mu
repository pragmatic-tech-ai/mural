// Default connector cap catalog — the five built-in arrow / circle /
// diamond end-caps from § 3.6 of
// [docs/connectors.md](../../../../docs/connectors.md).
//
// Each cap is a DataTemplate keyed for `@…Cap` reference, rendering a
// single `Path` whose geometry is authored in CAP-LOCAL coordinates with
// the hot-point (arrow tip / circle centre) at local (0,0) and the body
// trailing into −X. The connector pipeline pins that origin to the
// resolved endpoint (Canvas.Left/Top) and rotates about it by the route
// tangent — flipping the source end 180° so one template reads correctly
// at both ends. See Connector.placeCap.
//
// `Connector.CapInset` (attached property) tells the route how far back
// to stop the painted line so it doesn't poke through a filled cap.
// Caps that sit ON the line (open arrow, open circle) leave it at 0.
//
// Paint binds against the per-end ConnectorCapDataContext the connector
// supplies as the cap's DataContext:
//   * filled caps  → Fill   = $Brush   (the connector's stroke colour)
//   * stroked caps → Stroke = $Pen     (the connector's full Pen)
// so a recoloured / rethickened connector recolours its caps.
//
// Merged into the root MuralFramework dictionary via an `import` clause
// in src/resources/framework.resources.mu.

resources Caps {
    // Open arrow — two stroke legs meeting at the tip, no fill. Sits on
    // the line, so no inset.
    DataTemplate x:key="ArrowCap" [DataType = ConnectorCapDataContext] {
        Path [ Data = "M -12,-6 L 0,0 L -12,6", Stroke = $Pen, Connector.CapInset = 0 ]
    }

    // Filled triangle — point at the endpoint, flat back 12 units in.
    // Inset 12 keeps the line from poking through the flat back.
    DataTemplate x:key="FilledArrowCap" [DataType = ConnectorCapDataContext] {
        Path [ Data = "M 0,0 L -12,-6 L -12,6 Z", Fill = $Brush, Connector.CapInset = 12 ]
    }

    // Open (stroked) circle centred on the endpoint, radius 6. The line
    // runs to the centre under the disc edge — inset 0.
    DataTemplate x:key="OpenCircleCap" [DataType = ConnectorCapDataContext] {
        Path
            [ Data               = "M -6,0 A 6,6 0 1,0 6,0 A 6,6 0 1,0 -6,0 Z",
              Stroke             = $Pen,
              Connector.CapInset = 0 ]
    }

    // Filled disc centred on the endpoint, radius 6. Inset 6 (= radius)
    // stops the line at the disc's near edge.
    DataTemplate x:key="FilledCircleCap" [DataType = ConnectorCapDataContext] {
        Path
            [ Data               = "M -6,0 A 6,6 0 1,0 6,0 A 6,6 0 1,0 -6,0 Z",
              Fill               = $Brush,
              Connector.CapInset = 6 ]
    }

    // Filled rhombus — near point at the endpoint, far point 16 units in,
    // side points at ±5. Inset 8 stops the line at the rhombus centre.
    DataTemplate x:key="DiamondCap" [DataType = ConnectorCapDataContext] {
        Path [ Data = "M 0,0 L -8,-5 L -16,0 L -8,5 Z", Fill = $Brush, Connector.CapInset = 8 ]
    }
}
