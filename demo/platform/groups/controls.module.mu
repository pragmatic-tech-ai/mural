// ControlsModule — the "Controls" demo group as a ShellModule. One capability
// (rail item) backed by ControlsService; the group's demo view dictionaries merge here.
import ControlsService from "./controls-service.mjs"
import BadgeDemo from "../../demos/badge/badge.mu.js"
import BannerDemo from "../../demos/banner/banner.mu.js"
import BottomAppBarDemo from "../../demos/bottom-app-bar/bottom-app-bar.mu.js"
import BottomSheetDemo from "../../demos/bottom-sheet/bottom-sheet.mu.js"
import ButtonGroupDemo from "../../demos/button-group/button-group.mu.js"
import CardDemo from "../../demos/card/card.mu.js"
import CarouselDemo from "../../demos/carousel/carousel.mu.js"
import ContextMenuDemo from "../../demos/context-menu/context-menu.mu.js"
import DatePickerDemo from "../../demos/date-picker/date-picker.mu.js"
import DialogDemo from "../../demos/dialog/dialog.mu.js"
import DrawerDemo from "../../demos/drawer/drawer.mu.js"
import FabDemo from "../../demos/fab/fab.mu.js"
import FabMenuDemo from "../../demos/fab-menu/fab-menu.mu.js"
import IconButtonDemo from "../../demos/icon-button/icon-button.mu.js"
import ListBoxDemo from "../../demos/list-box/list-box.mu.js"
import LoadingIndicatorDemo from "../../demos/loading-indicator/loading-indicator.mu.js"
import MenuDemo from "../../demos/menu/menu.mu.js"
import NavigationRailDemo from "../../demos/navigation-rail/navigation-rail.mu.js"
import PropertyGridDemo from "../../demos/property-grid/property-grid.mu.js"
import SegmentedButtonDemo from "../../demos/segmented-button/segmented-button.mu.js"
import SideSheetDemo from "../../demos/side-sheet/side-sheet.mu.js"
import SliderDemo from "../../demos/slider/slider.mu.js"
import SpinEditDemo from "../../demos/spin-edit/spin-edit.mu.js"
import SplitButtonDemo from "../../demos/split-button/split-button.mu.js"
import SplitterDemo from "../../demos/splitter/splitter.mu.js"
import StatusBarDemo from "../../demos/status-bar/status-bar.mu.js"
import TextBoxDemo from "../../demos/text-box/text-box.mu.js"
import TimePickerDemo from "../../demos/time-picker/time-picker.mu.js"
import ToggleButtonDemo from "../../demos/toggle-button/toggle-button.mu.js"
import ToolBarDemo from "../../demos/tool-bar/tool-bar.mu.js"
import TopAppBarDemo from "../../demos/top-app-bar/top-app-bar.mu.js"
import TreeViewDemo from "../../demos/tree-view/tree-view.mu.js"

shell module ControlsModule [ Name = "Controls" ] {
    .services: {
        ControlsService
    }

    resources: {
        merge BadgeDemo
        merge BannerDemo
        merge BottomAppBarDemo
        merge BottomSheetDemo
        merge ButtonGroupDemo
        merge CardDemo
        merge CarouselDemo
        merge ContextMenuDemo
        merge DatePickerDemo
        merge DialogDemo
        merge DrawerDemo
        merge FabDemo
        merge FabMenuDemo
        merge IconButtonDemo
        merge ListBoxDemo
        merge LoadingIndicatorDemo
        merge MenuDemo
        merge NavigationRailDemo
        merge PropertyGridDemo
        merge SegmentedButtonDemo
        merge SideSheetDemo
        merge SliderDemo
        merge SpinEditDemo
        merge SplitButtonDemo
        merge SplitterDemo
        merge StatusBarDemo
        merge TextBoxDemo
        merge TimePickerDemo
        merge ToggleButtonDemo
        merge ToolBarDemo
        merge TopAppBarDemo
        merge TreeViewDemo
    }

    Capability [ Name = "Controls", Icon = @ControlsIcon, ServiceKey = ControlsService ]
}
