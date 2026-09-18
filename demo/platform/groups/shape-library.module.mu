// ShapeLibraryModule — the "Shape library" demo group as a ShellModule. One capability
// (rail item) backed by ShapeLibraryService; the group's demo view dictionaries merge here.
import ShapeLibraryService from "./shape-library-service.mjs"
import ShapesDemo from "../../demos/shapes/shapes.mu.js"

shell module ShapeLibraryModule [ Name = "Shape library" ] {
    .services: {
        ShapeLibraryService
    }

    resources: {
        merge ShapesDemo
    }

    Capability [ Name = "Shape library", Icon = @ShapeLibraryIcon, ServiceKey = ShapeLibraryService ]
}
