/*
 * Copyright 1998-2025 by Northwoods Software Corporation
 * All Rights Reserved.
 *
 * Floorplan Class
 * A Floorplan is a Diagram with special rules
 */
import * as go from 'gojs';
import { NodeLabelDraggingTool } from './NodeLabelDraggingTool.js';
import { WallBuildingTool } from './WallBuildingTool.js';
import { WallReshapingTool } from './WallReshapingTool.js';
export class Floorplan extends go.Diagram {
    /**
     * A Floorplan is a special kind of Diagram. It supports walls, rooms, and many other common features a Floorplan might have.
     * @param div The HTML DIV element or DIV element id for the Floorplan to use
     */
    constructor(div) {
        super(div);
        /**
         * Floor Plan Setup:
         * Initialize Floor Plan, Floor Plan Listeners, Floor Plan Overview
         */
        // When a FloorplanPalette instance is made, it is automatically added to a Floorplan's "palettes" property
        this._palettes = new Array();
        // Point Nodes, Dimension Links, Angle Nodes on the Floorplan (never in model data)
        this._pointNodes = new go.Set();
        this._dimensionLinks = new go.Set();
        this._angleNodes = new go.Set();
        const $ = go.GraphObject.make;
        this.allowLink = false;
        this.undoManager.isEnabled = true;
        this.layout.isInitial = false;
        this.layout.isOngoing = false;
        this.model = new go.GraphLinksModel({
            modelData: {
                units: 'meters',
                unitsAbbreviation: 'm',
                unitsConversionFactor: 0.02,
                gridSize: 10,
                wallThickness: 10,
                preferences: {
                    showWallGuidelines: true,
                    showWallLengths: true,
                    showWallAngles: true,
                    showOnlySmallWallAngles: true,
                    showGrid: true,
                    gridSnap: true,
                },
            },
        });
        this.grid = $(go.Panel, 'Grid', {
            gridCellSize: new go.Size(this.model.modelData.gridSize, this.model.modelData.gridSize),
            visible: true,
        }, $(go.Shape, 'LineH', { stroke: 'lightgray' }), $(go.Shape, 'LineV', { stroke: 'lightgray' }));
        this.contextMenu = makeContextMenu();
        this.commandHandler.canGroupSelection = function () {
            return true;
        };
        this.commandHandler.canUngroupSelection = function () {
            return true;
        };
        this.commandHandler.archetypeGroupData = { isGroup: true };
        // Listeners
        // if a wall is copied, update its geometry
        this.addDiagramListener('SelectionCopied', function (e) {
            const fp = e.diagram;
            fp.selection.iterator.each(function (part) {
                if (part.category === 'WallGroup') {
                    const w = part;
                    fp.updateWall(w);
                }
            });
        });
        // If a node has been dropped onto the Floorplan from a Palette...
        this.addDiagramListener('ExternalObjectsDropped', function (e) {
            const garbage = new Array();
            const fp = e.diagram;
            fp.selection.iterator.each(function (node) {
                // if floor node dropped, try to make a room node here with that floor brush style
                if (node.category === 'FloorNode') {
                    const floorNode = node;
                    const pt = fp.lastInput.documentPoint;
                    // try to make a room here
                    fp.maybeAddRoomNode(pt, floorNode.data.floorImage);
                    garbage.push(floorNode);
                }
            });
            for (const i in garbage) {
                e.diagram.remove(garbage[i]);
            }
        });
        // When a wall is copied / pasted, update the wall geometry, angle, etc
        this.addDiagramListener('ClipboardPasted', function (e) {
            const fp = e.diagram;
            e.diagram.selection.iterator.each(function (node) {
                if (node.category === 'WallGroup') {
                    const w = node;
                    fp.updateWall(w);
                }
            });
        });
        // Display different help depending on selection context
        this.addDiagramListener('ChangedSelection', function (e) {
            const floorplan = e.diagram;
            floorplan.skipsUndoManager = true;
            floorplan.startTransaction('remove dimension links and angle nodes');
            floorplan.pointNodes.iterator.each(function (node) {
                e.diagram.remove(node);
            });
            floorplan.dimensionLinks.iterator.each(function (link) {
                e.diagram.remove(link);
            });
            const missedDimensionLinks = new Array(); // used only in undo situations
            floorplan.links.iterator.each(function (link) {
                if (link.data.category === 'DimensionLink')
                    missedDimensionLinks.push(link);
            });
            for (let i = 0; i < missedDimensionLinks.length; i++) {
                e.diagram.remove(missedDimensionLinks[i]);
            }
            floorplan.pointNodes.clear();
            floorplan.dimensionLinks.clear();
            floorplan.angleNodes.iterator.each(function (node) {
                e.diagram.remove(node);
            });
            floorplan.angleNodes.clear();
            floorplan.commitTransaction('remove dimension links and angle nodes');
            floorplan.skipsUndoManager = false;
            floorplan.updateWallDimensions();
            floorplan.updateWallAngles();
        });
        // if user deletes a wall, update rooms
        this.addDiagramListener('SelectionDeleted', function (e) {
            const wrt = e.diagram.toolManager.mouseDownTools.elt(3);
            wrt.joinAllColinearWalls();
            wrt.splitAllWalls();
            wrt.performAllMitering();
            // also update rooms
            const deletedParts = e.subject;
            // make sure to get all the walls that were just deleted, so updateAllRoomBoundaries knows about what change triggered it
            const walls = new go.Set();
            deletedParts.iterator.each(function (p) {
                if (p instanceof go.Group && p.data.category === 'WallGroup') {
                    const w = p;
                    walls.add(w);
                }
            });
            const fp = e.diagram;
            fp.updateAllRoomBoundaries(walls);
        });
        /*
         * Node Templates
         * Add Default Node, Multi-Purpose Node, Window Node, Palette Wall Node, and Door Node to the Node Template Map
         */
        this.nodeTemplateMap.add('', makeDefaultNode()); // Default Node (furniture)
        this.nodeTemplateMap.add('MultiPurposeNode', makeMultiPurposeNode()); // Multi-Purpose Node
        this.nodeTemplateMap.add('WindowNode', makeWindowNode()); // Window Node
        this.nodeTemplateMap.add('PaletteWallNode', makePaletteWallNode()); // Palette Wall Node
        this.nodeTemplateMap.add('DoorNode', makeDoorNode()); // Door Node
        this.nodeTemplateMap.add('RoomNode', makeRoomNode()); // Room Node
        /*
         * Group Templates
         * Add Default Group, Wall Group to Group Template Map
         */
        this.groupTemplateMap.add('', makeDefaultGroup()); // Default Group
        this.groupTemplateMap.add('WallGroup', makeWallGroup()); // Wall Group
        /*
         * Install Custom Tools
         * Wall Building Tool, Wall Reshaping Tool
         */
        const wallBuildingTool = new WallBuildingTool();
        this.toolManager.mouseDownTools.insertAt(0, wallBuildingTool);
        const wallReshapingTool = new WallReshapingTool();
        this.toolManager.mouseDownTools.insertAt(3, wallReshapingTool);
        wallBuildingTool.isEnabled = false;
        const nodeLabelDraggingTool = new NodeLabelDraggingTool();
        this.toolManager.mouseMoveTools.insertAt(3, nodeLabelDraggingTool);
        /*
         * Tool Overrides
         */
        // If a wall was dragged to intersect another wall, update angle displays
        this.toolManager.draggingTool.doDeactivate = function () {
            // go.DraggingTool.prototype.doMouseUp.call(this);
            const fp = this.diagram;
            const tool = this;
            fp.updateWallAngles();
            this.isGridSnapEnabled = this.diagram.model.modelData.preferences.gridSnap;
            // maybe recalc rooms, if dragging a wall
            let selectedWall = null;
            fp.selection.iterator.each(function (p) {
                if (p.category === 'WallGroup' && selectedWall == null) {
                    const w = p;
                    selectedWall = w;
                }
                else if (p.category === 'WallGroup' && selectedWall !== null) {
                    // only worry about selectedWall if there is a single selected wall (cannot drag multiple walls at once)
                    selectedWall = undefined;
                }
            });
            if (selectedWall) {
                const selWallSet = new go.Set();
                selWallSet.add(selectedWall);
                fp.updateAllRoomBoundaries(selWallSet);
                const wrt = fp.toolManager.mouseDownTools.elt(3);
                wrt.performMiteringOnWall(selectedWall);
                fp.updateWall(selectedWall);
            }
            go.DraggingTool.prototype.doDeactivate.call(this);
        };
        // If user holds SHIFT while dragging, do not use grid snap
        this.toolManager.draggingTool.doMouseMove = function () {
            if (this.diagram.lastInput.shift) {
                this.isGridSnapEnabled = false;
            }
            else
                this.isGridSnapEnabled = this.diagram.model.modelData.preferences.gridSnap;
            go.DraggingTool.prototype.doMouseMove.call(this);
        };
        // When resizing, constantly update the node info box with updated size info; constantly update Dimension Links
        this.toolManager.resizingTool.doMouseMove = function () {
            const floorplan = this.diagram;
            floorplan.updateWallDimensions();
            go.ResizingTool.prototype.doMouseMove.call(this);
        };
        // When resizing a wallPart, do not allow it to be resized past the nearest wallPart / wall endpoints
        this.toolManager.resizingTool.computeMaxSize = function () {
            const tool = this;
            const adornedObject = tool.adornedObject;
            if (adornedObject !== null) {
                const obj = adornedObject.part;
                let wall = null;
                if (obj !== null) {
                    wall = this.diagram.findPartForKey(obj.data.group);
                }
                if (wall !== null &&
                    obj !== null &&
                    (obj.category === 'DoorNode' || obj.category === 'WindowNode')) {
                    let stationaryPt = null;
                    let movingPt = null;
                    let resizeAdornment = null;
                    const oitr = obj.adornments.iterator;
                    while (oitr.next()) {
                        const adorn = oitr.value;
                        if (adorn.name === 'WallPartResizeAdornment') {
                            resizeAdornment = adorn;
                        }
                    }
                    if (resizeAdornment !== null) {
                        const ritr = resizeAdornment.elements.iterator;
                        while (ritr.next()) {
                            const el = ritr.value;
                            const handle = tool.handle;
                            if (handle !== null) {
                                if (el instanceof go.Shape && el.alignment === handle.alignment) {
                                    movingPt = el.getDocumentPoint(go.Spot.Center);
                                }
                                if (el instanceof go.Shape && el.alignment !== handle.alignment) {
                                    stationaryPt = el.getDocumentPoint(go.Spot.Center);
                                }
                            }
                        }
                    }
                    // find the constrainingPt; that is, the endpoint (wallPart endpoint or wall endpoint)
                    // that is the one closest to movingPt but still farther from stationaryPt than movingPt
                    // this loop checks all other wallPart endpoints of the wall that the resizing wallPart is a part of
                    let constrainingPt;
                    let closestDist = Number.MAX_VALUE;
                    wall.memberParts.iterator.each(function (part) {
                        if (part.data.key !== obj.data.key) {
                            const endpoints = getWallPartEndpoints(part);
                            for (let i = 0; i < endpoints.length; i++) {
                                const point = endpoints[i];
                                const distanceToMovingPt = Math.sqrt(point.distanceSquaredPoint(movingPt));
                                if (distanceToMovingPt < closestDist) {
                                    const distanceToStationaryPt = Math.sqrt(point.distanceSquaredPoint(stationaryPt));
                                    if (distanceToStationaryPt > distanceToMovingPt) {
                                        closestDist = distanceToMovingPt;
                                        constrainingPt = point;
                                    }
                                }
                            }
                        }
                    });
                    // if we're not constrained by a wallPart endpoint, the constraint will come from a wall endpoint; figure out which one
                    if (constrainingPt === undefined || constrainingPt === null) {
                        if (wall.data.startpoint.distanceSquaredPoint(movingPt) >
                            wall.data.startpoint.distanceSquaredPoint(stationaryPt))
                            constrainingPt = wall.data.endpoint;
                        else
                            constrainingPt = wall.data.startpoint;
                    }
                    // set the new max size of the wallPart according to the constrainingPt
                    let maxLength = 0;
                    if (stationaryPt !== null) {
                        maxLength = Math.sqrt(stationaryPt.distanceSquaredPoint(constrainingPt));
                    }
                    return new go.Size(maxLength, wall.data.thickness);
                }
            }
            return go.ResizingTool.prototype.computeMaxSize.call(tool);
        };
        this.toolManager.draggingTool.isGridSnapEnabled = true;
    } // end Floorplan constructor
    // Get / set array of all Palettes associated with this Floorplans
    get palettes() {
        return this._palettes;
    }
    set palettes(value) {
        this._palettes = value;
    }
    // Get / set pointNodes
    get pointNodes() {
        return this._pointNodes;
    }
    set pointNodes(value) {
        this._pointNodes = value;
    }
    // Get / set dimensionLinks
    get dimensionLinks() {
        return this._dimensionLinks;
    }
    set dimensionLinks(value) {
        this._dimensionLinks = value;
    }
    // Get / set angleNodes
    get angleNodes() {
        return this._angleNodes;
    }
    set angleNodes(value) {
        this._angleNodes = value;
    }
    /**
     * Convert num number of pixels (document units) to units, using the adjustable conversion factor stored in modeldata
     * @param {number} num This is in document units (colloquially, if inaccurately, referred to as "pixels")
     * @return {number}
     */
    convertPixelsToUnits(num) {
        const units = this.model.modelData.units;
        const factor = this.model.modelData.unitsConversionFactor;
        return num * factor;
        /*if (units === 'meters') return (num / 100) * factor;
        if (units === 'feet') return (num / 30.48) * factor;
        if (units === 'inches') return (num / 2.54) * factor;
        return num * factor; */
    }
    /**
     * Take a number of units, convert to cm, then divide by 2, (1px = 2cm, change this if you want to use a different paradigm)
     * @param {number} num This is in document units (colloquially, if inaccurately, referred to as "pixels")
     * @return {number}
     */
    convertUnitsToPixels(num) {
        const units = this.model.modelData.units;
        const factor = this.model.modelData.unitsConversionFactor;
        return num / factor;
        /*if (units === 'meters') return (num * 100) / factor;
        if (units === 'feet') return (num * 30.48) / factor;
        if (units === 'inches') return (num * 2.54) / factor;
        return num / factor; */
    }
    /**
     * @param units string
     */
    getUnitsAbbreviation(units) {
        switch (units) {
            case 'centimeters': {
                return 'cm';
            }
            case 'meters': {
                return 'm';
            }
            case 'inches': {
                return 'in';
            }
            case 'feet': {
                return 'ft';
            }
        }
        return units;
    }
    /**
     * Convert a number of oldUnits to newUnits
     * @param {string} oldUnits cm | m | ft | in
     * @param {string} newUnits cm | m | ft | in
     * @param {number} num The number of old units to convert to new ones
     * @return {number} The number of new units
     */
    convertUnits(oldUnits, newUnits, num) {
        const fp = this;
        let newNum = num;
        oldUnits = fp.getUnitsAbbreviation(oldUnits);
        newUnits = fp.getUnitsAbbreviation(newUnits);
        switch (oldUnits) {
            case 'cm': {
                switch (newUnits) {
                    case 'm': {
                        newNum *= 0.01;
                        break;
                    }
                    case 'ft': {
                        newNum *= 0.0328084;
                        break;
                    }
                    case 'in': {
                        newNum *= 0.393701;
                        break;
                    }
                }
                break;
            } // end cm oldUnits case
            case 'm': {
                switch (newUnits) {
                    case 'cm': {
                        newNum *= 100;
                        break;
                    }
                    case 'ft': {
                        newNum *= 3.28084;
                        break;
                    }
                    case 'in': {
                        newNum *= 39.3701;
                        break;
                    }
                }
                break;
            } // end m oldUnits case
            case 'ft': {
                switch (newUnits) {
                    case 'cm': {
                        newNum *= 30.48;
                        break;
                    }
                    case 'm': {
                        newNum *= 0.3048;
                        break;
                    }
                    case 'in': {
                        newNum *= 12;
                        break;
                    }
                }
                break;
            } // end ft oldUnits case
            case 'in': {
                switch (newUnits) {
                    case 'cm': {
                        newNum *= 2.54;
                        break;
                    }
                    case 'm': {
                        newNum *= 0.0254;
                        break;
                    }
                    case 'ft': {
                        newNum *= 0.0833333;
                        break;
                    }
                }
                break;
            } // end in oldUnitsCase
        }
        return newNum;
    }
    makeDefaultFurniturePaletteNodeData() {
        return FURNITURE_NODE_DATA_ARRAY;
    }
    makeDefaultWallpartsPaletteNodeData() {
        return WALLPARTS_NODE_DATA_ARRAY;
    }
    /**
     * Turn on wall building tool, set WallBuildingTool.isBuildingDivider to false
     */
    enableWallBuilding() {
        const fp = this;
        const wallBuildingTool = fp.toolManager.mouseDownTools.elt(0);
        wallBuildingTool.isBuildingDivider = false;
        const wallReshapingTool = fp.toolManager.mouseDownTools.elt(3);
        wallBuildingTool.isEnabled = true;
        wallReshapingTool.isEnabled = false;
        fp.currentCursor = 'crosshair';
        // clear resize adornments on walls/windows, if there are any
        fp.nodes.iterator.each(function (n) {
            n.clearAdornments();
        });
        fp.clearSelection();
    }
    /**
     * Turn on wall building tool, set WallBuildingTool.isBuildingDivider to true
     */
    enableDividerBuilding() {
        const fp = this;
        const wallBuildingTool = fp.toolManager.mouseDownTools.elt(0);
        fp.enableWallBuilding();
        wallBuildingTool.isBuildingDivider = true;
        fp.currentCursor = 'crosshair';
    }
    /**
     * Turn off wall building tool
     */
    disableWallBuilding() {
        const fp = this;
        const wallBuildingTool = fp.toolManager.mouseDownTools.elt(0);
        const wallReshapingTool = fp.toolManager.mouseDownTools.elt(3);
        wallBuildingTool.isEnabled = false;
        wallReshapingTool.isEnabled = true;
        wallBuildingTool.isBuildingDivider = false;
        fp.currentCursor = '';
        // clear resize adornments on walls/windows, if there are any
        fp.nodes.iterator.each(function (n) {
            n.clearAdornments();
        });
        fp.clearSelection();
    }
    /**
     * Called when a checkbox in the options window is changed.
     * Perform the appropriate changes to model data.
     * @param checkboxId The string id of the HTML checkbox element that's been changed
     */
    checkboxChanged(checkboxId) {
        const floorplan = this;
        floorplan.skipsUndoManager = true;
        floorplan.startTransaction('change preference');
        const element = document.getElementById(checkboxId);
        switch (checkboxId) {
            case 'showGridCheckbox': {
                floorplan.grid.visible = element.checked;
                floorplan.model.modelData.preferences.showGrid = element.checked;
                break;
            }
            case 'gridSnapCheckbox': {
                floorplan.toolManager.draggingTool.isGridSnapEnabled = element.checked;
                floorplan.model.modelData.preferences.gridSnap = element.checked;
                break;
            }
            case 'wallGuidelinesCheckbox':
                floorplan.model.modelData.preferences.showWallGuidelines = element.checked;
                break;
            case 'wallLengthsCheckbox':
                floorplan.model.modelData.preferences.showWallLengths = element.checked;
                floorplan.updateWallDimensions();
                break;
            case 'wallAnglesCheckbox':
                floorplan.model.modelData.preferences.showWallAngles = element.checked;
                floorplan.updateWallAngles();
                break;
            case 'onlySmallWallAnglesCheckbox': {
                floorplan.model.modelData.preferences.showOnlySmallWallAngles = element.checked;
                floorplan.updateWallAngles();
                break;
            }
        }
        floorplan.commitTransaction('change preference');
        floorplan.skipsUndoManager = false;
    }
    /**
     * Change the units being used by the Floorplan
     * @param {HTMLFormElement} form The form element containing the units radio buttons in the options menu
     */
    changeUnits(form) {
        const fp = this;
        const radios = form.getElementsByTagName('input');
        const prevUnits = fp.model.modelData.units;
        // find selected radio, set units in modelData to the proper units
        for (let i = 0; i < radios.length; i++) {
            const radio = radios[i];
            if (radio.checked) {
                const unitsStr = radio.id;
                fp.model.setDataProperty(fp.model.modelData, 'units', unitsStr);
                // also set unitsAbbreviation
                switch (radio.id) {
                    case 'centimeters':
                        fp.model.setDataProperty(fp.model.modelData, 'unitsAbbreviation', 'cm');
                        break;
                    case 'meters':
                        fp.model.setDataProperty(fp.model.modelData, 'unitsAbbreviation', 'm');
                        break;
                    case 'feet':
                        fp.model.setDataProperty(fp.model.modelData, 'unitsAbbreviation', 'ft');
                        break;
                    case 'inches':
                        fp.model.setDataProperty(fp.model.modelData, 'unitsAbbreviation', 'in');
                        break;
                }
            }
        }
        const unitsAbbreviation = fp.model.modelData.unitsAbbreviation;
        const unitAbbrevInputs = document.getElementsByClassName('unitsBox');
        for (let i = 0; i < unitAbbrevInputs.length; i++) {
            const uaInput = unitAbbrevInputs[i];
            uaInput.value = unitsAbbreviation;
        }
        // explicitly set the units conversion factor by converting the old one to the new units equivalent
        const unitsConversionFactorInput = document.getElementById('unitsConversionFactorInput');
        const oldUnitsConversionFactor = parseFloat(unitsConversionFactorInput.value);
        const units = fp.model.modelData.units;
        const newUnitsConverstionFactor = fp.convertUnits(prevUnits, units, oldUnitsConversionFactor);
        fp.model.setDataProperty(fp.model.modelData, 'unitsConversionFactor', newUnitsConverstionFactor);
        unitsConversionFactorInput.value = newUnitsConverstionFactor.toString();
        const unitInputs = document.getElementsByClassName('unitsInput');
        for (let i = 0; i < unitInputs.length; i++) {
            const input = unitInputs[i];
            if (input.id !== 'unitsConversionFactorInput') {
                let value = parseFloat(input.value);
                value = parseFloat(fp.convertUnits(prevUnits, units, value).toFixed(4));
                input.value = value.toString();
            }
        }
    }
    /**
     * Change the units conversion factor for the Floorplan.
     * @param {HTMLInputElement} unitsConversionFactorInput The input element that contains the units conversion factor for the Floorplan
     * @param {HTMLInputElement} gridSizeInput Optional. If provided, the grid will be updated too
     */
    changeUnitsConversionFactor(unitsConversionFactorInput, gridSizeInput) {
        const floorplan = this;
        const val = parseFloat(unitsConversionFactorInput.value);
        if (isNaN(val) || !val || val === undefined)
            return;
        floorplan.skipsUndoManager = true;
        floorplan.model.set(floorplan.model.modelData, 'unitsConversionFactor', val);
        if (gridSizeInput) {
            floorplan.changeGridSize(gridSizeInput);
        }
        floorplan.skipsUndoManager = false;
    }
    /**
     * Change the grid size being used for the Floorplan.
     * @param gridSizeInput The input that contains the grid size to use
     */
    changeGridSize(gridSizeInput) {
        const fp = this;
        fp.skipsUndoManager = true;
        fp.startTransaction('change grid size');
        let inputVal = 0;
        if (!isNaN(parseFloat(gridSizeInput.value)) &&
            gridSizeInput.value != null &&
            gridSizeInput.value !== '' &&
            gridSizeInput.value !== undefined &&
            parseFloat(gridSizeInput.value) > 0)
            inputVal = parseFloat(gridSizeInput.value);
        else {
            gridSizeInput.value = fp.convertPixelsToUnits(10).toString(); // if bad input given, revert to 20cm (10px) or unit equivalent
            inputVal = parseFloat(gridSizeInput.value);
        }
        inputVal = fp.convertUnitsToPixels(inputVal);
        fp.grid.gridCellSize = new go.Size(inputVal, inputVal);
        // fp.toolManager.draggingTool.gridCellSize = new go.Size(inputVal, inputVal);
        fp.model.setDataProperty(fp.model.modelData, 'gridSize', inputVal);
        fp.commitTransaction('change grid size');
        fp.skipsUndoManager = false;
    }
    /**
     * Get the side of a wall (1 or 2) to use as the room boundary
     * @param {go.Group} w
     * @param {go.Point} ip
     * @return {number}
     */
    getCounterClockwiseWallSide(w, ip) {
        const fp = this;
        const wrt = fp.toolManager.mouseDownTools.elt(3);
        // these are the mitering point data properties of the wall opposite from the intersection point
        let prop1 = null;
        let prop2 = null;
        // If intersection point (ip) is wall (w)'s data.endpoint, prop1 = smpt1, prop2 = smpt2
        if (wrt.pointsApproximatelyEqual(w.data.endpoint, ip)) {
            prop1 = 'smpt1';
            prop2 = 'smpt2';
        }
        else {
            prop1 = 'empt1';
            prop2 = 'empt2';
        }
        const A = ip;
        const B = w.data[prop2];
        const C = w.data[prop1];
        // A = intersection point, B = w.data[prop1], C = w.data.[prop2]
        // if AC is counterclockwise of AB, return 2; else return 1
        function isClockwise(a, b, c) {
            const bool = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0;
            return bool;
        }
        if (!isClockwise(A, B, C)) {
            return 1;
        }
        else
            return 2;
    }
    /**
     * Returns the intersection point between the two lines.
     * Lines are implied by two endpoints each.
     * @param {go.Point} a1 Point Endpoint 1 of line A
     * @param {go.Point} a2 Point Endpoint 2 of line A
     * @param {go.Point} b1 Point Endpoint 1 of line B
     * @param {go.Point} b2 Point Endpoint 2 of line B
     * @return {go.Point | null}
     */
    getLinesIntersection(a1, a2, b1, b2) {
        const am = (a1.y - a2.y) / (a1.x - a2.x); // slope of line 1
        const bm = (b1.y - b2.y) / (b1.x - b2.x); // slope of line 2
        // Line A is vertical
        if (am === Infinity || am === -Infinity) {
            const ipx = a1.x;
            // line B y-intercept
            const bi = -1 * (bm * b1.x - b1.y);
            // Solve for line B's y at x=ipx
            const ipy = bm * ipx + bi;
            return new go.Point(ipx, ipy);
        }
        // Line B is vertical
        if (bm === Infinity || bm === -Infinity) {
            const ipx = b1.x;
            // line A y-intercept
            const ai = -1 * (am * a1.x - a1.y);
            // Solve for line A's y at x=ipx
            const ipy = am * ipx + ai;
            return new go.Point(ipx, ipy);
        }
        if (Math.abs(am - bm) < Math.pow(2, -52)) {
            return null;
        }
        else {
            const ipx = (am * a1.x - bm * b1.x + b1.y - a1.y) / (am - bm);
            const ipy = (am * bm * (b1.x - a1.x) + bm * a1.y - am * b1.y) / (bm - am);
            const ip = new go.Point(ipx, ipy);
            return ip;
        }
    }
    /**
     * Update the geometries of all rooms in the floorplan. This is called when a wall is added or reshaped or deleted
     * @param {go.Set<go.Group>} changedWalls This is the set of walls that was just added / updated / removed. Often this is a single element
     */
    updateAllRoomBoundaries(changedWalls) {
        const fp = this;
        const wrt = fp.toolManager.mouseDownTools.elt(3);
        const rooms = fp.findNodesByExample({ category: 'RoomNode' });
        // rooms to remove
        const garbage = new Array();
        rooms.iterator.each(function (r) {
            // do this until you've tried all wall intersections for the room OR the room boundaries have been successfully updated
            let boundsFound = false;
            let triedAllIntersections = false;
            const seenW1 = new go.Set(); // the walls that have been used as w1 (later)
            while (!boundsFound && !triedAllIntersections) {
                // find a point "pt" that will definitely be in the room implied by the r.boundaryWalls (if the area is still enclosed)
                // to do so, find 2 boundaryWalls that are connected and get a point just outside their intersection (along the proper mitering side)
                // Note: Neither of these 2 walls may be in "changedWalls" (the walls that were added / modified)
                // The first of these walls must still be valid (i.e. it was not split or joined with another wall in the action that trieggered this function)
                const bw = r.data.boundaryWalls;
                let e1 = null;
                let e2 = null; // entries that represent wall / mitering side pairs to use to find pt
                for (let i = 0; i < bw.length + 1; i++) {
                    const entry = bw[i % bw.length];
                    const wk = entry[0];
                    const ww = fp.findNodeForKey(wk);
                    if (ww === null)
                        continue;
                    if (!changedWalls.contains(ww) && !seenW1.contains(ww)) {
                        if (e1 === null) {
                            e1 = entry;
                        }
                        else if (e1 !== null && e2 === null) {
                            e2 = entry;
                        }
                    }
                    else if (e1 !== null && e2 === null) {
                        e2 = entry;
                    }
                    else if (e1 === null) {
                        e1 = null;
                        e2 = null;
                    }
                }
                // with these 2 entries (walls / mitering sides), we now get a point that would definitely be in the room (if the area is still enclosed)
                // first, get the segments implied by mitering sides of the walls
                let w1 = null;
                let w2 = null;
                let s1 = null;
                let s2 = null;
                if (e1 !== null && e2 !== null) {
                    w1 = fp.findNodeForKey(e1[0]);
                    s1 = e1[1];
                    w2 = fp.findNodeForKey(e2[0]);
                    s2 = e2[1];
                }
                else {
                    triedAllIntersections = true;
                    continue;
                }
                if (e1 !== null && w1 !== null) {
                    seenW1.add(w1);
                }
                const w1s = w1.data['smpt' + s1];
                const w1e = w1.data['empt' + s1];
                const w2s = w2.data['smpt' + s2];
                const w2e = w2.data['empt' + s2];
                // at which point do these 2 wall sides intersect?
                const ip = fp.getSegmentsIntersection(w1s, w1e, w2s, w2e);
                if (ip === null) {
                    continue;
                }
                // the prop name of the point on the other mitering side of ip. we'll use this to get the angle of the intersection
                const w1os = s1 === 1 ? 2 : 1;
                // let prop: string = wrt.pointsApproximatelyEqual(ip, w1s) ? "smpt" + w1os : "empt" + w1os;
                const distToS = ip.distanceSquaredPoint(w1.data['smpt' + w1os]);
                const distToE = ip.distanceSquaredPoint(w1.data['empt' + w1os]);
                // which other side pt is closer to ip? That's the oip
                const oip = distToS <= distToE ? w1.data.startpoint : w1.data.endpoint;
                const ang = oip.directionPoint(ip);
                const newPt = wrt.translateAndRotatePoint(ip, ang - 90, 0.5);
                // debug -- show calculated pts
                /*
                const $ = go.GraphObject.make;
                 fp.add(
                   $(go.Node, 'Spot', { locationSpot: go.Spot.Center, location: oip },
                     $(go.Shape, 'Circle', { desiredSize: new go.Size(5, 5), fill: 'red' })
                   )
                 );
        
                 fp.add(
                   $(go.Node, 'Spot', { locationSpot: go.Spot.Center, location: ip },
                     $(go.Shape, 'Circle', { desiredSize: new go.Size(5, 5), fill: 'green' })
                   )
                 );
        
                 fp.add(
                   $(go.Node, 'Spot', { locationSpot: go.Spot.Center, location: newPt },
                     $(go.Shape, 'Circle', { desiredSize: new go.Size(5, 5), fill: 'cyan' })
                   )
                 );*/
                boundsFound = fp.maybeAddRoomNode(newPt, r.data.floorImage, r);
            }
            // if the room boundaries are never found, this room must be removed
            if (!boundsFound) {
                garbage.push(r);
            }
        });
        for (let i = 0; i < garbage.length; i++) {
            fp.remove(garbage[i]);
        }
        // ensure proper room position by updating target bindings
        fp.updateAllTargetBindings();
    }
    /**
     * Tries to add a Room Node from a given point.
     * The point must be enclosed by walls.
     * @param {go.Point} pt
     * @param {string} floorImage The image relative path to use as the Pattern brush for the room's flooring
     * @param {go.Node} roomToUpdate Optional. If this is provided, the walls found for the area will be assigned to this room node
     * @return {boolean} Whether or not the pt is enclosed by room boundaries
     */
    maybeAddRoomNode(pt, floorImage, roomToUpdate) {
        if (roomToUpdate === undefined || roomToUpdate === null) {
            roomToUpdate = null;
        }
        const fp = this;
        // if the pt is on a Room or Wall, do nothing
        const walls = fp.findNodesByExample({
            category: 'WallGroup',
        });
        let isPtOnRoomOrWall = false;
        // make sure "pt" is not inside a wall or room node. If it is, do not run this function
        walls.iterator.each(function (w) {
            if (fp.isPointInWall(w, pt)) {
                isPtOnRoomOrWall = true;
            }
        });
        const rooms = fp.findNodesByExample({
            category: 'RoomNode',
        });
        rooms.iterator.each(function (r) {
            if (roomToUpdate === null ||
                (roomToUpdate !== null &&
                    roomToUpdate !== undefined &&
                    roomToUpdate.data.key !== r.data.key)) {
                const isInRoom = fp.isPointInRoom(r, pt);
                if (isInRoom) {
                    // Edge: it's possible we're within the polygon created by the rooms boundary walls, but over one of its holes
                    // if so, we may still be able to make new room here
                    let isPtInHole = false;
                    for (let i = 0; i < r.data.holes.length; i++) {
                        const hole = r.data.holes[i];
                        const polygon = fp.makePolygonFromRoomBoundaries(hole);
                        if (polygon !== null) {
                            if (fp.isPointInPolygon(polygon.toArray(), pt)) {
                                isPtInHole = true;
                            }
                        }
                    }
                    if (!isPtInHole) {
                        isPtOnRoomOrWall = true;
                    }
                }
            }
        });
        if (isPtOnRoomOrWall) {
            return false;
        }
        // get thr boundary walls for the room
        const boundaryWalls = fp.getRoomWalls(pt);
        if (boundaryWalls === null) {
            return false;
        }
        // also include holes in room
        const holes = fp.findRoomHoles(boundaryWalls, pt);
        // check if this is an update or add op
        if (roomToUpdate !== null) {
            fp.startTransaction('update room boundaryWalls and holes');
            fp.model.setDataProperty(roomToUpdate.data, 'boundaryWalls', boundaryWalls);
            fp.model.setDataProperty(roomToUpdate.data, 'holes', holes);
            fp.commitTransaction('update room boundaryWalls and holes');
        }
        else {
            if (floorImage === null || floorImage === undefined) {
                floorImage = 'images/textures/floor1.jpg';
            }
            const roomData = {
                key: 'Room',
                category: 'RoomNode',
                name: 'Room Name',
                boundaryWalls: boundaryWalls,
                holes: holes,
                floorImage: floorImage,
                showLabel: true,
                showFlooringOptions: true,
            };
            fp.model.addNodeData(roomData);
            roomToUpdate = fp.findPartForData(roomData);
        }
        fp.updateRoom(roomToUpdate);
        return true;
    }
    /**
     * Returns a specially formatted array that represents the boundaries of a room.
     * These boundaries are the walls enclosing the room, which must include the given point
     * The array is formatted with entries [wall, mitering side]
     * @param {go.Point} pt
     * @return {Array<any>}
     */
    getRoomWalls(pt) {
        const fp = this;
        // get the all the walls, in order from closest to farthest, the line from pt upwards would hit
        const walls = fp.findNodesByExample({
            category: 'WallGroup',
        });
        const oPt = new go.Point(pt.x, pt.y - 10000);
        const wallsDistArr = new Array(); // array of wall/dist pairs [[wallA, 15], [wallB, 30]] -- this makes sorting easier than if we were using a Map
        walls.iterator.each(function (w) {
            const ip = fp.getSegmentsIntersection(pt, oPt, w.data.startpoint, w.data.endpoint);
            if (ip !== null) {
                const dist = Math.sqrt(ip.distanceSquaredPoint(pt));
                wallsDistArr.push([w, dist]);
            }
        });
        // sort all walls the line from pt to oPt intersects, in order of proximity to pt
        wallsDistArr.sort(function (a, b) {
            const distA = a[1];
            const distB = b[1];
            if (distA === distB)
                return 0;
            else if (distA < distB)
                return -1;
            else
                return 1;
        });
        // helper function -- copies a "path" (list of walls) up to a certain wall node
        function selectivelyCopyPath(path, nodeToStopAt) {
            const p = new Array();
            let copyNoMore = false;
            for (let i = 0; i < path.length; i++) {
                const entry = path[i];
                const wk = entry[0];
                const w = fp.findNodeForKey(wk);
                const side = entry[1];
                if (!copyNoMore) {
                    p.push([w.data.key, side]);
                    if (w.data.key === nodeToStopAt.data.key) {
                        copyNoMore = true;
                    }
                }
            }
            return p;
        }
        /**
         * Recursively walk counter-clockwise along all walls connected to firstWall until you get back to first wall
         * @param {go.Group | null} wall
         * @param {Array<any>} path
         * @param {go.Set<Array<any>>} possiblePaths
         * @param {go.Set<go.Group> | null} seenWalls
         * @param {go.Group} origWall
         * @param {go.Point | null} prevPt
         * @return {go.Set<Array<any>>}
         */
        function recursivelyFindPaths(wall, path, possiblePaths, seenWalls, origWall, prevPt) {
            if (wall === null) {
                return null;
            }
            if (seenWalls === undefined || seenWalls === null) {
                seenWalls = new go.Set();
            }
            seenWalls.add(wall);
            // find which wall endpoint has angle between 180 and 270 from the right
            const wrt = fp.toolManager.mouseDownTools.elt(3);
            const sPt = wall.data.startpoint;
            const ePt = wall.data.endpoint;
            const mpt = new go.Point((sPt.x + ePt.x) / 2, (sPt.y + ePt.y) / 2);
            const sa = mpt.directionPoint(sPt); // angle from mpt to spt
            let ip; // intersection point
            let op; // other point
            if (prevPt === undefined || prevPt === null) {
                ip = sa >= 90 && sa <= 270 ? sPt : ePt; // cc point
                op = sa >= 90 && sa <= 270 ? ePt : sPt;
            }
            else {
                ip = wrt.pointsApproximatelyEqual(sPt, prevPt) ? ePt : sPt;
                op = wrt.pointsApproximatelyEqual(sPt, prevPt) ? sPt : ePt;
            }
            // get all walls at ip
            const ccWalls = wrt.getAllWallsAtIntersection(ip, true);
            // sort these walls based on their clockwise angle, relative to wall
            // sort all involved walls in any clockwise order
            ccWalls.sort(function (a, b) {
                // fp.sortWallsClockwise(a,b);
                const B = fp.getWallsIntersection(a, b);
                if (B === null)
                    return 0;
                const as = a.data.startpoint;
                const ae = a.data.endpoint;
                const bs = b.data.startpoint;
                const be = b.data.endpoint;
                const A = wrt.pointsApproximatelyEqual(ip, as) ? ae : as;
                const C = wrt.pointsApproximatelyEqual(ip, bs) ? be : bs;
                const angA = B.directionPoint(A);
                const angB = B.directionPoint(C);
                if (angA > angB)
                    return 1;
                else if (angA < angB)
                    return -1;
                else
                    return 0;
            });
            // offset the intersection walls (maintain relative order) s.t. wall "wall" is first
            const intersectionWalls = ccWalls.toArray();
            const intersectionWallsReordered = new Array();
            let j = intersectionWalls.indexOf(wall);
            for (let i = 0; i < intersectionWalls.length; i++) {
                const w = intersectionWalls[j];
                intersectionWallsReordered.push(w);
                j = (j + 1) % intersectionWalls.length;
            }
            ccWalls.clear();
            for (let i = 0; i < intersectionWallsReordered.length; i++) {
                const w = intersectionWallsReordered[i];
                ccWalls.add(w);
            }
            ccWalls.iterator.each(function (w) {
                // failsafe
                if (w === undefined || w === null) {
                    possiblePaths = new go.Set();
                    return possiblePaths;
                }
                // Base case : if we've found our way back to originalWall (add path to possiblePaths)
                if ((w.data.key === origWall.data.key || ccWalls.contains(origWall)) &&
                    wall.data.key !== origWall.data.key) {
                    if (path !== null) {
                        possiblePaths.add(path);
                    }
                }
                else if (seenWalls !== null && !seenWalls.contains(w)) {
                    // define path as all walls that came up until this wall
                    if (path === undefined || path === null) {
                        path = new Array();
                        // First wall is special case; just find out which mitering side is closer to the original point used for this room construction
                        // get intersection point from pt-oPt each of walls's mitering sides
                        // It's possible pt-oPt does not intersect one or both of the actual segments making up the mitering sides of wall,
                        // so use the lines implied by the mitering points, not just finite segments
                        const ip1 = fp.getLinesIntersection(pt, oPt, wall.data.smpt1, wall.data.empt1);
                        const ip2 = fp.getLinesIntersection(pt, oPt, wall.data.smpt2, wall.data.empt2);
                        if (ip1 !== null && ip2 !== null) {
                            // whichever mitering side pt-oPt strikes first (which intersection point is closer to pt) is the one to start with
                            const dist1 = Math.sqrt(ip1.distanceSquaredPoint(pt));
                            const dist2 = Math.sqrt(ip2.distanceSquaredPoint(pt));
                            const side1 = dist1 < dist2 ? 1 : 2;
                            path.push([wall.data.key, side1]);
                        }
                    }
                    else {
                        path = selectivelyCopyPath(path, wall);
                    }
                    // get the "side" of the wall to use for the room boundary (side 1 or side 2, as defined by the mitering points in data)
                    const side = fp.getCounterClockwiseWallSide(w, ip);
                    // add w to path
                    path.push([w.data.key, side]);
                    recursivelyFindPaths(w, path, possiblePaths, seenWalls, origWall, ip);
                }
            });
            return possiblePaths;
        } // end recursivelyFindPaths
        // iterate over these ordered walls until one allows for us to identify the room boundaries
        // if none of these walls allow for that, "pt" is not enclosed by walls, so there is no room
        let roomOuterBoundaryPts = null;
        let roomOuterBoundaryPath = null; // an array with entries [[wall, side], [wall, side]...]
        for (let i = 0; i < wallsDistArr.length; i++) {
            const entry = wallsDistArr[i];
            const w = entry[0];
            // I'm pretty sure the first possbilePath is always the right one
            // This is an ordered path of all the walls that make up this room. It's  Map, where keys are walls and values are the wall sides used for room boundaries (1 or 2)
            let path = new Array();
            let possiblePaths = new go.Set();
            possiblePaths = recursivelyFindPaths(w, null, possiblePaths, null, w, null);
            if (possiblePaths === null || possiblePaths.count === 0)
                continue; // no path
            path = possiblePaths.first();
            // construct a polygon (Points) from this path
            const polygon = fp.makePolygonFromRoomBoundaries(path);
            if (polygon !== null) {
                // make sure none of the walls in "path" have an endpoint inside the resulting polygon (this means an internal wall is included, those are dealt with later)
                let pathIncludesInternalWall = false;
                for (let j = 0; j < path.length; j++) {
                    const e = path[j];
                    const wwk = e[0];
                    const ww = fp.findNodeForKey(wwk);
                    const ept = ww.data.endpoint;
                    const spt = ww.data.startpoint;
                    if (fp.isPointInPolygon(polygon.toArray(), ept) ||
                        fp.isPointInPolygon(polygon.toArray(), spt)) {
                        pathIncludesInternalWall = true;
                    }
                }
                // make sure "pt" is enclosed by the polygon -- if so, these are the outer room bounds
                if (fp.isPointInPolygon(polygon.toArray(), pt) /*&& !pathIncludesInternalWall*/) {
                    roomOuterBoundaryPts = polygon;
                    roomOuterBoundaryPath = path;
                    break;
                }
            }
        }
        // if we've found outer room boundary pts, we now need to account for some edge cases
        // 1) Be sure to include "internal" walls in room boundaries (walls inside the room that connect to an outer boundary wall)
        // 2) "Holes" -- walls / rooms inside these outer boundaries that do not connect to an outer boundary wall
        if (roomOuterBoundaryPts !== null) {
            // check if there are any walls with an endpoint in the room's outer boundaries polygon.
            // If so, update room's boundaryWalls data and geometry to add those internal wall(s)
            const newRoomBoundaryWalls = fp.addInternalWallsToRoom(roomOuterBoundaryPts, roomOuterBoundaryPath);
            // let newRoomBoundaryWalls = roomOuterBoundaryPath;
            return newRoomBoundaryWalls;
        }
        else {
            return null;
        }
    }
    /**
     * Returns an ordered List of Points that represents the polygon of a room, given a room's boundaryWalls array
     * @param {Array<any>} path -- a specially formatted array, where entries are 2 entry arrays [wall, mitering side]
     * This type of structure is used for a room's "boundaryWalls" data property
     * @return {go.List<go.Point> | null}
     */
    makePolygonFromRoomBoundaries(path) {
        const fp = this;
        const polygon = new go.List();
        const boundaryWalls = path;
        if (boundaryWalls === null || boundaryWalls.length < 2) {
            return null;
        }
        const firstWallKey = boundaryWalls[0][0];
        const firstWall = fp.findNodeForKey(firstWallKey);
        const firstSide = boundaryWalls[0][1];
        const secondWallKey = boundaryWalls[1][0];
        const secondWall = fp.findNodeForKey(secondWallKey);
        if (firstWall === null || secondWall === null) {
            return null;
        }
        // find where first and second wall meet
        // if that's near firstWall's smpt[side] pt, start with empt[side] pt; else, vice versa (i.e. pick the farthest pt)
        const ip = fp.getWallsIntersection(firstWall, secondWall);
        if (ip === null)
            return null;
        const propS = 'smpt' + firstSide;
        const propE = 'empt' + firstSide;
        const ptS = firstWall.data[propS];
        const ptE = firstWall.data[propE];
        const distS = Math.sqrt(ip.distanceSquaredPoint(ptS));
        const distE = Math.sqrt(ip.distanceSquaredPoint(ptE));
        const closestPt = distS < distE ? ptS : ptE;
        const farthestPt = closestPt.equals(ptS) ? ptE : ptS;
        polygon.add(farthestPt);
        polygon.add(closestPt);
        let prevPt = closestPt;
        let prevWall = firstWall;
        for (let i = 0; i < boundaryWalls.length; i++) {
            const entry = boundaryWalls[i];
            if (typeof entry === 'string')
                continue;
            const wk = entry[0];
            const w = fp.findNodeForKey(wk);
            if (w === null) {
                return null;
            }
            const s = entry[1];
            if (w.data.key !== firstWall.data.key) {
                const propS1 = 'smpt' + s;
                const propE1 = 'empt' + s;
                const ptS1 = w.data[propS1];
                const ptE1 = w.data[propE1];
                const distS1 = Math.sqrt(prevPt.distanceSquaredPoint(ptS1));
                const distE1 = Math.sqrt(prevPt.distanceSquaredPoint(ptE1));
                const closestPt1 = distS1 < distE1 ? ptS1 : ptE1;
                const farthestPt1 = closestPt1.equals(ptS1) ? ptE1 : ptS1;
                polygon.add(closestPt1);
                polygon.add(farthestPt1);
                prevPt = farthestPt1;
                prevWall = w;
            }
        }
        return polygon;
    }
    /**
     * Used to a/b sort walls in a clockwise order
     * @param {go.Group} a wall a
     * @param {go.Group} b wall b
     * @return {number}
     */
    sortWallsClockwise(a, b) {
        const fp = this;
        const wrt = fp.toolManager.mouseDownTools.elt(3);
        const B = fp.getWallsIntersection(a, b);
        if (B === null) {
            return 0;
        }
        const as = a.data.startpoint;
        const ae = a.data.endpoint;
        const bs = b.data.startpoint;
        const be = b.data.endpoint;
        const ip = fp.getSegmentsIntersection(as, ae, bs, be);
        if (ip === null) {
            return 0;
        }
        const A = wrt.pointsApproximatelyEqual(ip, as) ? ae : as;
        const C = wrt.pointsApproximatelyEqual(ip, bs) ? be : bs;
        const angA = B.directionPoint(A);
        const angB = B.directionPoint(C);
        if (angA > angB)
            return 1;
        else if (angA < angB)
            return -1;
        else
            return 0;
    }
    /**
     * Sort a list of walls in clockwise order, relative to a given wall (that given wall will be the first element of the returned list)
     * @param {go.List<go.Group>} walls The list to sort
     * @param {go.Group} wall The reference wall
     * @return {go.List<go.Group>}
     */
    sortWallsClockwiseWithSetStartWall(walls, wall) {
        const fp = this;
        walls.sort(function (a, b) {
            return fp.sortWallsClockwise(a, b);
        });
        // offset the intersection walls (maintain relative order) s.t. wall "wall" is first
        const intersectionWalls = walls.toArray();
        const intersectionWallsReordered = new Array();
        let j = intersectionWalls.indexOf(wall);
        for (let i = 0; i < intersectionWalls.length; i++) {
            const w = intersectionWalls[j];
            intersectionWallsReordered.push(w);
            j = (j + 1) % intersectionWalls.length;
        }
        walls.clear();
        for (let i = 0; i < intersectionWallsReordered.length; i++) {
            const w = intersectionWallsReordered[i];
            walls.add(w);
        }
        return walls;
    }
    /**
     * Returns updated room boundaries to include any internal walls to a room's geometry (if there are any)
     * @param {go.List<go.Point>} roomOuterBoundaryPts a Set of go.Points that describe the outer boundaries of a room
     * @param {Array<any>} roomOuterBoundaryPath an Array that describes the outer boundary walls of a room
     *  entries in the form of [[wall, side], [wall, side]...]
     * @return {Array<any>}
     */
    addInternalWallsToRoom(roomOuterBoundaryPts, roomOuterBoundaryPath) {
        const fp = this;
        const walls = fp.findNodesByExample({
            category: 'WallGroup',
        });
        const offendingWalls = new go.Set();
        walls.iterator.each(function (w) {
            // if (!w.data.isDivider) {
            const s = w.data.startpoint;
            const e = w.data.endpoint;
            if (fp.isPointInPolygon(roomOuterBoundaryPts.toArray(), s) ||
                fp.isPointInPolygon(roomOuterBoundaryPts.toArray(), e)) {
                offendingWalls.add(w);
            }
            // }
        });
        /**
         * Recursively finds all internal walls that eventually tie back to an initial intersection point along a room boundary wall
         * Returned path is an array with entries in the form of <wall key><wall side> (i.e. [ wallA1, wallB1, wallB2, wallA2 ] )
         * @param {go.Group} wall The current wall we're at
         * @param {go.List<go.Group>} iwalls Walls with an endpoint at ip
         * @param {go.Point} ip The current intersection point
         * @param {go.Set<string>} seenIp Set of pairs of stringified Points / wall keys that represent intersection points
         *   we're already accounting (from a specific wall) for somewhere in the stack
         *   Note: you may encounter the same intersection point from a different wall (if there is a cycle in this cluster)
         * @param {Array<any>} path Array of 2 entry arrays, [[wall, number], [wall, number]] (representing walls and sides of walls)
         * @param {go.Group} bw1 Boundary wall 1 -- the first boundary wall this cluster intersects
         * @param {go.Group} bw2 Boundary wall 2 -- when we reach this wall, we're done
         * @return {Array<any>} The internal cluster path
         */
        function recursivelyFindInteralClusterPath(wall, iwalls, ip, seenIp, path, bw1, bw2) {
            seenIp.add(go.Point.stringify(ip)); // remember we've handled this intersection point
            iwalls.iterator.each(function (fw) {
                // fw = "first" wall in intersection walls (that's not "wall"). This is always the wall immediately counterclockwise of wall
                if (fw.data.key !== wall.data.key) {
                    // if fw is bw2, return path, we're done
                    if (fw.data.key === bw2.data.key) {
                        if (path.indexOf('isDone') === -1) {
                            path.push('isDone');
                        }
                        return path;
                    }
                    // alternatively, if the path contains "isDone" string, don't do anything more
                    if (path.indexOf('isDone') !== -1) {
                        return path;
                    }
                    // find out which mitering side of the first wall in iwalls is immediately clockwise of "wall"
                    let side = null;
                    side = fp.getCounterClockwiseWallSide(fw, ip);
                    // push fw.data.key + side to path
                    const entry = [fw.data.key, side];
                    // if path already contains this exact entry, do not add it, we're starting to loop infinitely. stop now
                    for (let i = 0; i < path.length; i++) {
                        const e = path[i];
                        const wk = e[0];
                        const w = fp.findNodeForKey(wk);
                        const s = e[1];
                        if (fw.data.key === w.data.key && s === side) {
                            return;
                        }
                    }
                    path.push(entry);
                    const otherEndpoint = wrt.pointsApproximatelyEqual(ip, fw.data.startpoint)
                        ? fw.data.endpoint
                        : fw.data.startpoint;
                    // get all walls connected to other endpoint of fw (if any exist, and if seenIp does not include this other endpoint)
                    // (recursion)
                    let iw = wrt.getAllWallsAtIntersection(otherEndpoint, true);
                    // sort intersectionWalls s.t. they are clockwise, starting with bw1
                    if (iw !== null && iw.count > 1) {
                        iw = fp.sortWallsClockwiseWithSetStartWall(iw, fw);
                    }
                    let hasNotSeenIp = false;
                    if (!seenIp.contains(go.Point.stringify(otherEndpoint))) {
                        hasNotSeenIp = true;
                    }
                    // if we have seen this ip, maybe its OK -- iff the counter-clockwise side of the first wall in iw is nowhere in the path yet
                    let alreadySeen = false;
                    if (!hasNotSeenIp) {
                        // get first wall in iw
                        const fiw = iw.toArray()[1];
                        const side2 = fp.getCounterClockwiseWallSide(fiw, otherEndpoint);
                        for (let i = 0; i < path.length; i++) {
                            const entry1 = path[i];
                            const wk = entry1[0];
                            const w = fp.findNodeForKey(wk);
                            const s = entry1[1];
                            if (w.data.key === fiw.data.key && s === side2) {
                                alreadySeen = true;
                            }
                        }
                    }
                    // have we come full circle?
                    const atFinalIp = iw.contains(bw1);
                    const doContinue = hasNotSeenIp ? true : !alreadySeen && !atFinalIp;
                    if (iw.count > 1 && doContinue) {
                        return recursivelyFindInteralClusterPath(fw, iw, otherEndpoint, seenIp, path, bw1, bw2);
                    }
                    else if (!atFinalIp) {
                        const otherSide = side === 1 ? 2 : 1;
                        const entry2 = [fw.data.key, otherSide];
                        path.push(entry2);
                        let iw2 = wrt.getAllWallsAtIntersection(ip, true);
                        // sort intersectionWalls s.t. they are clockwise, starting with bw1
                        if (iw2 !== null && iw2.count > 1) {
                            iw2 = fp.sortWallsClockwiseWithSetStartWall(iw2, fw);
                        }
                        return recursivelyFindInteralClusterPath(fw, iw2, ip, seenIp, path, bw1, bw2);
                    }
                    else if (path.indexOf('isDone') === -1) {
                        path.push('isDone');
                        return;
                    }
                }
            });
            return path;
        } // end recursivelyFindInternalClusterPath
        const wrt = fp.toolManager.mouseDownTools.elt(3);
        // now go through offending walls
        const handledWalls = new go.Set();
        const internalPathsToInsert = new go.Map();
        offendingWalls.iterator.each(function (ow) {
            if (!handledWalls.contains(ow)) {
                const ows = ow.data.startpoint;
                const owe = ow.data.endpoint;
                // find the 2 boundaryWalls this offending wall shares an intersection point with
                let bw1 = null;
                let bw2 = null;
                let ip = null;
                for (let i = 0; i < roomOuterBoundaryPath.length; i++) {
                    const entry = roomOuterBoundaryPath[i];
                    if (typeof entry === 'string')
                        continue;
                    const wk = entry[0];
                    const w = fp.findNodeForKey(wk);
                    const s = w.data.startpoint;
                    const e = w.data.endpoint;
                    if (wrt.pointsApproximatelyEqual(s, ows) ||
                        wrt.pointsApproximatelyEqual(s, owe) ||
                        wrt.pointsApproximatelyEqual(e, ows) ||
                        wrt.pointsApproximatelyEqual(e, owe)) {
                        if (bw1 === null) {
                            bw1 = w; // bw1 must exist in the boundaryWalls array before bw2
                            ip = fp.getSegmentsIntersection(bw1.data.startpoint, bw1.data.endpoint, ows, owe);
                        }
                        else {
                            bw2 = w;
                        }
                    }
                }
                // edge case -- bw1 is the first entry in boundaryWalls array and bw2 is the last -- if so, switch them
                if (ip !== null &&
                    bw1 !== null &&
                    bw2 !== null &&
                    roomOuterBoundaryPath[0][0] === bw1.data.key &&
                    roomOuterBoundaryPath[roomOuterBoundaryPath.length - 1][0] === bw2.data.key) {
                    let temp = null;
                    temp = bw1;
                    bw1 = bw2;
                    bw2 = temp;
                }
                if (ip !== null) {
                    let intersectionWalls = new go.List();
                    if (bw1 !== null) {
                        // this is important -- this gives us a reference for "clockwise" when dealing with intersection walls
                        intersectionWalls.add(bw1);
                    }
                    // now, find any other offendingWalls that share this intersection point
                    offendingWalls.iterator.each(function (ow2) {
                        const ow2s = ow2.data.startpoint;
                        const ow2e = ow2.data.endpoint;
                        if (ip !== null) {
                            if (wrt.pointsApproximatelyEqual(ow2s, ip) ||
                                wrt.pointsApproximatelyEqual(ow2e, ip)) {
                                intersectionWalls.add(ow2);
                                handledWalls.add(ow2);
                            }
                        }
                    });
                    if (bw2 !== null) {
                        // this lets us know we are done in recursion when we get to this wall
                        intersectionWalls.add(bw2);
                    }
                    // sort intersectionWalls s.t. they are clockwise, starting with bw1
                    if (bw1 !== null) {
                        intersectionWalls = fp.sortWallsClockwiseWithSetStartWall(intersectionWalls, bw1);
                    }
                    const path = new Array(); // path of walls/sides for the offending walls as key+side (i.e. [[wall, number], [wall, number]] )
                    // recurse through all intersection walls until you reach bw2
                    const seenIp = new go.Set();
                    if (bw1 !== null && bw2 !== null) {
                        let p = recursivelyFindInteralClusterPath(bw1, intersectionWalls, ip, seenIp, path, bw1, bw2);
                        // cut the "isDone" flag
                        p = p.slice(0, p.length - 1);
                        // Remember to insert this path after bw1 in the roomOuterBoundaryPath after all this iteration
                        internalPathsToInsert.add(bw1, p);
                    }
                } // end intersection point check
            } // end handled wall check
        }); // end offendingWalls iterator
        // Insert internal paths into room boundaries now
        internalPathsToInsert.iterator.each(function (kvp) {
            const bw = kvp.key; // the boundary wall to insert this internal path directly after
            const path = kvp.value; // the path to insert
            let insertionIndex;
            for (let i = 0; i < roomOuterBoundaryPath.length; i++) {
                const entry = roomOuterBoundaryPath[i];
                if (typeof entry === 'string')
                    continue;
                const entryWk = entry[0];
                const entryW = fp.findNodeForKey(entryWk);
                if (entryW.data.key === bw.data.key) {
                    insertionIndex = i + 1;
                }
            }
            const firstArr = roomOuterBoundaryPath.slice(0, insertionIndex);
            const secondArr = roomOuterBoundaryPath.slice(insertionIndex, roomOuterBoundaryPath.length);
            roomOuterBoundaryPath = firstArr.concat(path).concat(secondArr);
        });
        // roomOuterBoundaryPath now includes internal walls connected to the original outer boundaries
        return roomOuterBoundaryPath;
    } // end addInternalWallsToRoom
    /**
     * Given a wall and a mitering side (1 or 2), return the endpoint of the wall s.t. the "inside" remains on the right
     * This aids in the clockwise traversal of wall edges
     * @param {go.Group} w
     * @param {number} side The mitering side of w being used
     * @return {go.Point | null}
     */
    getClockwiseWallEndpoint(w, side) {
        const fp = this;
        const wrt = fp.toolManager.mouseDownTools.elt(3);
        let ip = null;
        let op = null;
        // in this context, sPt and ePt refer to the start and end points of w's mitering side, "side"
        const sPt = w.data['smpt' + side];
        const ePt = w.data['empt' + side];
        // get two points, one "outside" mitering side "side" of w, and within "inside"
        const mPt = new go.Point((sPt.x + ePt.x) / 2, (sPt.y + ePt.y) / 2);
        const a = sPt.directionPoint(ePt) + 180; // perpindicular to angle of w
        const offset = w.data.thickness / 2;
        // get 2 points 1/2 w thickness from w's midpoint at angles a and a+180
        const pt1 = wrt.translateAndRotatePoint(mPt, a, offset);
        const pt2 = wrt.translateAndRotatePoint(mPt, a + 180, offset);
        let insidePt = null;
        let outsidePt = null;
        /**
         * Helper function, returns whether a point is to the left or right of a segment (if one thinks of orienting themselves, standing at one endpoint, looking to the other)
         * @param {go.Point} pt The point to check
         * @param {go.Point} rayS The first point of the segment
         * @param {go.Point} rayE The second point of the segment
         * @return {boolean}
         */
        function isPointLeftOfRay(pt, rayS, rayE) {
            return (pt.y - rayS.y) * (rayE.x - rayS.x) > (pt.x - rayS.x) * (rayE.y - rayS.y);
        }
        if (fp.isPointInWall(w, pt1)) {
            insidePt = pt1;
            outsidePt = pt2;
        }
        else {
            insidePt = pt2;
            outsidePt = pt1;
        }
        // now, imagine standing on this mitering side of w and looking from sPt to ePt, or from ePt to sPt
        // in which situation is the "inside" pt on your right?
        // whichever one that is, use the second endpoint (ePt or sPt) as the ip to go to next
        // this will ensure we are always moving clockwise around the walls in this hole, so our room geometry is constructed properly later
        if (isPointLeftOfRay(insidePt, sPt, ePt)) {
            ip = w.data.endpoint;
            op = w.data.startpoint;
        }
        else {
            ip = w.data.startpoint;
            op = w.data.endpoint;
        }
        return ip;
    }
    /**
     * Find all the "holes" in a room.
     * These are walls / wall clusters that are inside a room's boundaries but do not connect to the room boundary walls.
     * They are used to construct "holes" in the room's polygon, and their area is subtracted from the room's polygon's area to correctly represent floor space
     * IMPORTANT: This function must be run after the internal walls that DO connect to room outer boundaries have been added. This is done in addInternalWallsToRoom()
     *  It is assumed the roomBoundaryWalls parameter includes all connected room boundary walls, as it is used to find interior walls not connected to the room boundaries
     * @param {Array<any>} roomBoundaryWalls Specially formatted Array for the boundaries of the room, where entries are [wall, mitering side]
     * @param {go.Point} pt The original pt used to generate the room. See {@link getRoomWalls} for more detail
     * @return {go.Array<Array<any>>} @TODO CHANGE THIS TO AN ARRAY OF ARRAYS
     *  A go.Set of Arrays. Each Array represents a hole path. Array entries are in the form of [wall, mitering side]. These are used to construct
     *  the holes in the room geometry later, and their areas are subtracted from the polygon area of the room boundaries to correctly get floor area
     */
    findRoomHoles(roomBoundaryWalls, pt) {
        const fp = this;
        const wrt = fp.toolManager.mouseDownTools.elt(3);
        const walls = fp.findNodesByExample({
            category: 'WallGroup',
        });
        // offendingWalls is a Set of walls inside the room boundaries, not included in the room boundaries (these walls will make the holes)
        const offendingWalls = new go.Set();
        const roomOuterBoundaryPts = fp.makePolygonFromRoomBoundaries(roomBoundaryWalls);
        walls.iterator.each(function (w) {
            const s = w.data.startpoint;
            const e = w.data.endpoint;
            if (roomOuterBoundaryPts !== null &&
                (fp.isPointInPolygon(roomOuterBoundaryPts.toArray(), s) ||
                    fp.isPointInPolygon(roomOuterBoundaryPts.toArray(), e))) {
                // make sure this wall w is not in the roomBoundaryWalls anywhere
                let isBoundaryWall = false;
                for (let i = 0; i < roomBoundaryWalls.length; i++) {
                    const entry = roomBoundaryWalls[i];
                    const wallKey = entry[0];
                    const wall = fp.findNodeForKey(wallKey);
                    if (wall.data.key === w.data.key) {
                        isBoundaryWall = true;
                    }
                }
                if (!isBoundaryWall) {
                    offendingWalls.add(w);
                }
            }
        });
        // keep track of the offendingWalls we have handled so far
        const seenWalls = new go.Set();
        /**
         * Recursively find the path of the hole starting at origWall.
         * @param {go.Group} w
         * @param {go.Set<string> | null} seenIp
         * @param {Array<any> | null} path
         * @param {go.Point | null} prevPt
         * @param {go.Group} origWall
         * @return {Array<any>}
         */
        function recursivelyFindHolePath(w, seenIp, path, prevPt, origWall) {
            // one time thing: if path is null (not made yet), add w to path
            // need to do special calculation to get the proper mitering side for w
            let side = null; // the mitering side of w, will only be set if w is the first wall
            if (path === null || path === undefined) {
                path = new Array();
                // First wall is special case; just find out which mitering side is closer to the original point used for this room construction
                // get intersection point from pt-mPt each of walls's mitering sides
                // It's possible pt-mPt does not intersect one or both of the actual segments making up the mitering sides of w,
                // so use the lines implied by the mitering points, not just finite segments
                const ws = w.data.startpoint;
                const we = w.data.endpoint;
                const mPt = new go.Point((ws.x + we.x) / 2, (ws.y + we.y) / 2);
                const ip1 = fp.getLinesIntersection(pt, mPt, w.data.smpt1, w.data.empt1);
                const ip2 = fp.getLinesIntersection(pt, mPt, w.data.smpt2, w.data.empt2);
                if (ip1 !== null && ip2 !== null) {
                    // whichever mitering side pt-mPt strikes first (which intersection point is closer to pt) is the one to start with
                    const dist1 = Math.sqrt(ip1.distanceSquaredPoint(pt));
                    const dist2 = Math.sqrt(ip2.distanceSquaredPoint(pt));
                    side = dist1 < dist2 ? 1 : 2;
                    seenWalls.add(w);
                    path.push([w.data.key, side]);
                }
            }
            if (path.indexOf('isDone') !== -1) {
                return path;
            }
            // get clockwise endpoint, ip, for w (only if prevPt is null or undefined, otherwise, just use the endpoint of w that is not prevPt)
            // const wrt: WallReshapingTool = fp.toolManager.mouseDownTools.elt(3) as WallReshapingTool;
            let ip = null; // intersection point (one of w's endpoints), the one we're gonna move to
            let op = null; // other endpoint of w
            const sPt = w.data.startpoint;
            const ePt = w.data.endpoint;
            if (prevPt !== null && prevPt !== undefined) {
                ip = wrt.pointsApproximatelyEqual(sPt, prevPt) ? ePt : sPt;
                op = wrt.pointsApproximatelyEqual(sPt, prevPt) ? sPt : ePt;
            }
            else {
                if (side !== null) {
                    ip = fp.getClockwiseWallEndpoint(w, side);
                    if (ip !== null) {
                        op = wrt.pointsApproximatelyEqual(ip, sPt) ? ePt : sPt;
                    }
                }
            }
            if (seenIp === null || seenIp === undefined) {
                seenIp = new go.Set();
            }
            // add ip to seenIp
            if (ip !== null) {
                seenIp.add(go.Point.stringify(ip));
            }
            // get all walls at ip, call that iw; sort clockwise with wall as the first element
            let iw = wrt.getAllWallsAtIntersection(ip, true);
            let oiw = wrt.getAllWallsAtIntersection(op, true);
            // sort iw s.t. they are clockwise, starting with w
            if (iw !== null && iw.count > 1) {
                iw = fp.sortWallsClockwiseWithSetStartWall(iw, w);
            }
            let hasNotSeenIp = false;
            if (ip !== null && !seenIp.contains(go.Point.stringify(ip))) {
                hasNotSeenIp = true;
            }
            // if we have seen this ip, maybe its OK -- iff the counter-clockwise side of the first wall in iw is nowhere in the path yet
            let alreadySeen = false;
            if (!hasNotSeenIp && iw.toArray().length > 0) {
                // get first wall in iw
                let fiw = null;
                if (iw.toArray().length > 1) {
                    fiw = iw.toArray()[1];
                }
                else {
                    fiw = iw.toArray()[0];
                }
                if (ip !== null) {
                    const side2 = fp.getCounterClockwiseWallSide(fiw, ip);
                    for (let i = 0; i < path.length; i++) {
                        const entry = path[i];
                        const wk = entry[0];
                        const ww = fp.findNodeForKey(wk);
                        const s = entry[1];
                        if (ww.data.key === fiw.data.key && s === side2) {
                            alreadySeen = true;
                        }
                    }
                }
            }
            // check if the path already contains both sides of w
            let s1 = false;
            let s2 = false;
            for (let i = 0; i < path.length; i++) {
                const entry = path[i];
                const wwk = entry[0];
                const ww = fp.findNodeForKey(wwk);
                if (ww.data.key === w.data.key && !s1) {
                    s1 = true;
                }
                else if (ww.data.key === w.data.key && s1 && !s2) {
                    s2 = true;
                }
            }
            // pred to check if there's only 1 wall in this hole
            const isSoloWallHole = s1 && s2 && alreadySeen && path.length < 3;
            // have we come full circle?
            const isNextClockwiseWallOrigWall = iw.count > 1 && iw.toArray()[1].data.key === origWall.data.key;
            const atFinalIp = (isNextClockwiseWallOrigWall && (w.data.key !== origWall.data.key || isSoloWallHole)) ||
                (isSoloWallHole && w.data.key === origWall.data.key);
            const doContinue = hasNotSeenIp ? true : !alreadySeen /*&& !atFinalIp*/;
            if (!doContinue && path.indexOf('isDone') === -1) {
                path.push('isDone');
            }
            if (doContinue) {
                // iterate over iw, with namespace fw
                iw.iterator.each(function (fw) {
                    // if there is more than one element in iw, skip first fw (it's w)
                    if (path !== null && fw.data.key !== w.data.key && path.indexOf('isDone') === -1) {
                        // get proper (CC?) mitering side, add entry to path, then recurse
                        if (ip !== null) {
                            const side1 = fp.getCounterClockwiseWallSide(fw, ip);
                            const entry = [fw.data.key, side1];
                            path.push(entry);
                            seenWalls.add(fw);
                            recursivelyFindHolePath(fw, seenIp, path, ip, origWall);
                        }
                    }
                    else if (iw.count === 1 && path !== null && path.indexOf('isDone') === -1) {
                        // find the current entry in path with fw
                        let entry = null;
                        for (let i = 0; i < path.length; i++) {
                            const pwk = path[i][0];
                            const pw = fp.findNodeForKey(pwk);
                            if (pw.data.key === fw.data.key) {
                                const s = path[i][1];
                                const os = s === 1 ? 2 : 1;
                                entry = [pw.data.key, os];
                            }
                        }
                        path.push(entry);
                        // if this is the only wall in the hole, add isDone to path
                        if (oiw.count === 1) {
                            path.push('isDone');
                        }
                    }
                });
            }
            if (path.indexOf('isDone') !== -1) {
                return path.slice(0, path.length - 1);
            }
            else if (oiw.count > 1) {
                // this is the last wall we traced
                const lw = iw.last();
                // sort iw s.t. they are clockwise, starting with lw
                if (oiw !== null && lw !== null) {
                    oiw = fp.sortWallsClockwiseWithSetStartWall(oiw, lw);
                }
                // the "parent wall" (the one that led to all walls in oiw) is the next, non "lw" wall in the clockwise-sorted oiw
                const parentw = oiw.toArray()[1];
                // add the mitering side of parent wall to the path that's not already in the path
                if (op !== null) {
                    const side1 = fp.getCounterClockwiseWallSide(parentw, op);
                    const entry = [parentw.data.key, side1];
                    // if this entry already exists, we've come full circle and are done
                    let entryExists = false;
                    for (let i = 0; i < path.length; i++) {
                        const entry2 = path[i];
                        const w1k = entry[0];
                        const w1 = fp.findNodeForKey(w1k);
                        const w2k = entry2[0];
                        const w2 = fp.findNodeForKey(w2k);
                        if (w1.data.key === w2.data.key && entry[1] === entry2[1]) {
                            entryExists = true;
                        }
                    }
                    if (entry !== null && !entryExists) {
                        path.push(entry);
                        seenWalls.add(parentw);
                        // now recurse
                        recursivelyFindHolePath(parentw, seenIp, path, op, origWall);
                    }
                    else if (entryExists) {
                        return path;
                    }
                }
            }
            if (path.indexOf('isDone') !== -1) {
                path = path.slice(0, path.length - 1);
            }
            return path;
        } // end recursivelyFindHolePath
        // A set of specially formatted Arrays, representing the paths of the holes
        // IMPORTANT: Hole paths must be clockwise to ensure proper geometry construction in updateRoom() function!
        const holes = new Array();
        offendingWalls.iterator.each(function (ow) {
            // if we haven't gotten a path for a hole that contains this wall yet...
            if (!seenWalls.contains(ow)) {
                // draw segement from pt to the ow's midpoint (mPt). Find all walls intersected by this segment
                const sPt = ow.data.startpoint;
                const ePt = ow.data.endpoint;
                const mPt = new go.Point((sPt.x + ePt.x) / 2, (sPt.y + ePt.y) / 2);
                const wallsDistArr = new Array(); // array of wall/dist pairs [[wallA, 15], [wallB, 30]] -- this makes sorting easier than if we were using a Map
                offendingWalls.iterator.each(function (w) {
                    const ip = fp.getSegmentsIntersection(pt, mPt, w.data.startpoint, w.data.endpoint);
                    if (ip !== null) {
                        const dist = Math.sqrt(ip.distanceSquaredPoint(pt));
                        wallsDistArr.push([w, dist]);
                    }
                });
                // sort all walls the line from pt to mPt intersects, in order of proximity to pt
                wallsDistArr.sort(function (a, b) {
                    const distA = a[1];
                    const distB = b[1];
                    if (distA === distB)
                        return 0;
                    else if (distA < distB)
                        return -1;
                    else
                        return 1;
                });
                // find the first wall, fw, this segment intersects that is not in the roomBoundaryWalls AND not already in seenWalls
                let fw = null;
                for (let i = 0; i < wallsDistArr.length; i++) {
                    const entryWall = wallsDistArr[i][0];
                    if (!seenWalls.contains(entryWall) && fw === null) {
                        fw = entryWall;
                    }
                }
                if (fw !== null) {
                    // fw is guaranteed to be a boundary wall for a hole; use it to get the cycle path for the hole
                    const path = recursivelyFindHolePath(fw, null, null, null, fw);
                    // Add any walls inside the polygon made by this path to seenWalls (we don't want to create holes within holes)
                    const polygon = fp.makePolygonFromRoomBoundaries(path);
                    if (polygon !== null) {
                        offendingWalls.iterator.each(function (ow2) {
                            const s = ow2.data.smpt1;
                            if (fp.isPointInPolygon(polygon.toArray(), s) ||
                                fp.isPointInPolygon(polygon.toArray(), s)) {
                                seenWalls.add(ow2);
                            }
                        });
                        holes.push(path);
                    }
                }
            }
        }); // end offendingWalls iterator
        return holes;
    } // end findRoomHoles
    /**
     * Returns an ordered List of Points for a given path.
     * A path is a special Array whose entries are of the form [wall, miteringSide]
     * This is mostly used with roomBoundaryWall and room hole paths
     * @param {Array<any>} path
     * @returns {go.List<go.Point>}
     */
    getPathPts(path) {
        const fp = this;
        const pts = new go.List();
        const firstWallKey = path[0][0];
        const firstWall = fp.findNodeForKey(firstWallKey);
        const firstSide = path[0][1];
        const secondWallKey = path[1][0];
        const secondWall = fp.findNodeForKey(secondWallKey);
        // find where first and second wall meet
        // if that's near firstWall's smpt[side] pt, start with empt[side] pt; else, vice versa (i.e. pick the farthest pt)
        let ip = fp.getWallsIntersection(firstWall, secondWall);
        // SPECIAL case -- if firstWall and secondWall are the same, make sure you get the ip that is clockwise
        // this means we are wrapping around a single wall to start, and we need to make sure we are doing so in a clockwise manner
        if (firstWall.data.key === secondWall.data.key) {
            ip = fp.getClockwiseWallEndpoint(firstWall, firstSide);
        }
        if (ip !== null) {
            const propS = 'smpt' + firstSide;
            const propE = 'empt' + firstSide;
            const ptS = firstWall.data[propS];
            const ptE = firstWall.data[propE];
            const distS = Math.sqrt(ip.distanceSquaredPoint(ptS));
            const distE = Math.sqrt(ip.distanceSquaredPoint(ptE));
            const closestPt = distS < distE ? ptS : ptE;
            const farthestPt = closestPt.equals(ptS) ? ptE : ptS;
            pts.add(farthestPt);
            pts.add(closestPt);
            let prevPt = closestPt;
            let prevWall = firstWall;
            for (let i = 0; i < path.length; i++) {
                const entry = path[i];
                if (typeof entry === 'string')
                    continue;
                const wk = entry[0];
                const w = fp.findNodeForKey(wk);
                const s = entry[1];
                if (i !== 0) {
                    const propS1 = 'smpt' + s;
                    const propE1 = 'empt' + s;
                    const ptS1 = w.data[propS1];
                    const ptE1 = w.data[propE1];
                    const distS1 = Math.sqrt(prevPt.distanceSquaredPoint(ptS1));
                    const distE1 = Math.sqrt(prevPt.distanceSquaredPoint(ptE1));
                    const closestPt1 = distS1 < distE1 ? ptS1 : ptE1;
                    const farthestPt1 = closestPt.equals(ptS1) ? ptE1 : ptS1;
                    // if the previous wall is the same as current wall, we're looping around the wall's geometry, so be sure to include its thickness border
                    if (prevWall.data.key === w.data.key) {
                        pts.add(prevPt);
                        pts.add(closestPt1);
                    }
                    pts.add(closestPt1);
                    pts.add(farthestPt1);
                    prevPt = farthestPt1;
                    prevWall = w;
                }
            }
        }
        return pts;
    }
    /**
     * Get the area of a given polygon.
     * The answer will be in document units -- to convert to floorplan units (cm, m, whatever)
     * you must call convertPixelsToUnits twice!
     * @param {Array<go.Point>} vs An ordered array of polygon vertices
     * @return {number}
     */
    getPolygonArea(vs) {
        let j = 0;
        let area = 0;
        for (let i = 0; i < vs.length; i++) {
            j = (i + 1) % vs.length;
            area += vs[i].x * vs[j].y;
            area -= vs[i].y * vs[j].x;
        }
        area /= 2;
        return area < 0 ? -area : area;
    }
    /**
     * Get the area of a given room.
     * This is the area of the polygon created by the outer boundary walls of the room, less the area of all the room holes.
     * @param {go.Node} r Room node
     * @return {number} This will be in document units, not floorplan units
     */
    getRoomArea(r) {
        const fp = this;
        const pts = fp.getPathPts(r.data.boundaryWalls);
        const area1 = fp.getPolygonArea(pts.toArray());
        // get the area of all the holes
        let area2 = 0;
        const holes = r.data.holes;
        for (let i = 0; i < holes.length; i++) {
            const h = holes[i];
            // get holes points
            const hPts = fp.getPathPts(h);
            const hArea = fp.getPolygonArea(hPts.toArray());
            // get area of hole, add it to area2
            area2 += hArea;
        }
        return area1 - area2;
    }
    /**
     * Tells whether a point is in a wall's geometry.
     * @param {go.Group} w
     * @param {go.Point} p
     * @return {boolean}
     */
    isPointInWall(w, p) {
        const floorplan = this;
        const orderedPoints = [
            w.data.startpoint,
            w.data.smpt1,
            w.data.empt1,
            w.data.endpoint,
            w.data.empt2,
            w.data.smpt2,
            w.data.startpoint,
        ];
        return floorplan.isPointInPolygon(orderedPoints, p);
    }
    /**
     * Tells whether a point is in a room's geometry
     * @param {go.Node} r room node
     * @param {go.Point} p point to check
     * @return {boolean}
     */
    isPointInRoom(r, p) {
        const fp = this;
        if (r === null || r === undefined || !(r instanceof go.Node) || r.data.category !== 'RoomNode')
            return false;
        const polygon = fp.makePolygonFromRoomBoundaries(r.data.boundaryWalls);
        if (polygon !== null) {
            const polyArr = polygon.toArray();
            const isInRoom = fp.isPointInPolygon(polyArr, p);
            return isInRoom;
        }
        return false;
    }
    /**
     * Return whether or not a given point is inside a given polygon
     * @param {Array<go.Point>} vs An ordered Array of polygon vertices
     * @param {go.Point} point The point to check
     * @return {boolean}
     */
    isPointInPolygon(vs, point) {
        // ray-casting algorithm based on
        // http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html
        const x = point.x;
        const y = point.y;
        let inside = false;
        for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            const xi = vs[i].x;
            const yi = vs[i].y;
            const xj = vs[j].x;
            const yj = vs[j].y;
            const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
            if (intersect)
                inside = !inside;
        }
        return inside;
    }
    /**
     * Update the geometry, angle, and location of a given wall
     * @param {go.Group} wall A reference to a valid Wall Group (defined below)
     */
    updateWall(wall) {
        if (wall.data.startpoint && wall.data.endpoint) {
            const shape = wall.findObject('SHAPE');
            const data = wall.data;
            // geometry is slightly different for Room Dividers vs. Walls
            let geo = null;
            let pts = [
                data.startpoint,
                data.endpoint,
                data.smpt1,
                data.smpt2,
                data.empt1,
                data.empt2,
            ];
            if (wall.data.isDivider) {
                shape.strokeWidth = 2;
                shape.opacity = 0.5;
            }
            // else {
            pts = [data.startpoint, data.endpoint, data.smpt1, data.smpt2, data.empt1, data.empt2];
            geo = new go.Geometry().add(new go.PathFigure(data.startpoint.x, data.startpoint.y)
                .add(new go.PathSegment(go.SegmentType.Line, data.smpt1.x, data.smpt1.y))
                .add(new go.PathSegment(go.SegmentType.Line, data.empt1.x, data.empt1.y))
                .add(new go.PathSegment(go.SegmentType.Line, data.endpoint.x, data.endpoint.y))
                .add(new go.PathSegment(go.SegmentType.Line, data.empt2.x, data.empt2.y))
                .add(new go.PathSegment(go.SegmentType.Line, data.smpt2.x, data.smpt2.y))
                .add(new go.PathSegment(go.SegmentType.Line, data.startpoint.x, data.startpoint.y)));
            // }
            geo.normalize();
            shape.geometry = geo;
            let smallestX = Number.MAX_VALUE;
            let smallestY = Number.MAX_VALUE;
            for (let i = 0; i < pts.length; i++) {
                const pt = pts[i];
                if (pt.x < smallestX) {
                    smallestX = pt.x;
                }
                if (pt.y < smallestY) {
                    smallestY = pt.y;
                }
            }
            // find smallest x and y values of all points and set that to the position of the wall node
            wall.position = new go.Point(smallestX, smallestY);
            wall.location = new go.Point(smallestX, smallestY);
        }
    }
    /**
     * Update the geometry, angle, and location of a given wall
     * @param {go.Node} room A reference to a valid Room Node (defined below)
     */
    updateRoom(room) {
        const fp = this;
        const shape = room.findObject('SHAPE');
        const geo = new go.Geometry();
        // build the room geo from wall boundary array in data
        const pts = new Array();
        const bw = room.data.boundaryWalls;
        if (bw === null)
            return;
        let fig = null;
        addPathToGeo(bw);
        /**
         * Internal, helper function. Add a path of boundary walls (specially formatted array) of walls/mitering sides to room's geo figure.
         * @param {Array<any>} boundaryWalls
         */
        function addPathToGeo(boundaryWalls) {
            const firstWallKey = boundaryWalls[0][0];
            const firstWall = fp.findNodeForKey(firstWallKey);
            const firstSide = boundaryWalls[0][1];
            const secondWallKey = boundaryWalls[1][0];
            const secondWall = fp.findNodeForKey(secondWallKey);
            // find where first and second wall meet
            // if that's near firstWall's smpt[side] pt, start with empt[side] pt; else, vice versa (i.e. pick the farthest pt)
            let ip = fp.getWallsIntersection(firstWall, secondWall);
            // SPECIAL case -- if firstWall and secondWall are the same, make sure you get the ip that is clockwise
            // this means we are wrapping around a single wall to start, and we need to make sure we are doing so in a clockwise manner
            if (firstWall.data.key === secondWall.data.key) {
                ip = fp.getClockwiseWallEndpoint(firstWall, firstSide);
            }
            if (ip === null)
                return;
            const propS = 'smpt' + firstSide;
            const propE = 'empt' + firstSide;
            const ptS = firstWall.data[propS];
            const ptE = firstWall.data[propE];
            const distS = Math.sqrt(ip.distanceSquaredPoint(ptS));
            const distE = Math.sqrt(ip.distanceSquaredPoint(ptE));
            const closestPt = distS < distE ? ptS : ptE;
            const farthestPt = closestPt.equals(ptS) ? ptE : ptS;
            const firstPt = farthestPt.copy();
            pts.push(farthestPt);
            pts.push(closestPt);
            if (fig === null) {
                fig = new go.PathFigure(farthestPt.x, farthestPt.y);
            }
            else {
                fig.add(new go.PathSegment(go.SegmentType.Move, farthestPt.x, farthestPt.y));
            }
            fig.add(new go.PathSegment(go.SegmentType.Line, closestPt.x, closestPt.y));
            let prevPt = closestPt;
            let prevWall = firstWall;
            for (let i = 0; i < boundaryWalls.length; i++) {
                const entry = boundaryWalls[i];
                if (typeof entry === 'string')
                    continue;
                const wk = entry[0];
                const w = fp.findNodeForKey(wk);
                const s = entry[1];
                if (i !== 0) {
                    const propS1 = 'smpt' + s;
                    const propE1 = 'empt' + s;
                    const ptS1 = w.data[propS1];
                    const ptE1 = w.data[propE1];
                    const distS1 = Math.sqrt(prevPt.distanceSquaredPoint(ptS1));
                    const distE1 = Math.sqrt(prevPt.distanceSquaredPoint(ptE1));
                    const closestPt1 = distS1 < distE1 ? ptS1 : ptE1;
                    const farthestPt1 = closestPt1.equals(ptS1) ? ptE1 : ptS1;
                    // if the previous wall is the same as current wall, we're looping around the wall's geometry, so be sure to include its thickness border
                    if (prevWall.data.key === w.data.key) {
                        fig.add(new go.PathSegment(go.SegmentType.Line, prevPt.x, prevPt.y));
                        fig.add(new go.PathSegment(go.SegmentType.Line, closestPt1.x, closestPt1.y));
                    }
                    fig.add(new go.PathSegment(go.SegmentType.Line, closestPt1.x, closestPt1.y));
                    fig.add(new go.PathSegment(go.SegmentType.Line, farthestPt1.x, farthestPt1.y));
                    pts.push(closestPt1);
                    pts.push(farthestPt1);
                    prevPt = farthestPt1;
                    prevWall = w;
                }
            }
            // close geometry?
            fig.add(new go.PathSegment(go.SegmentType.Line, firstPt.x, firstPt.y));
        }
        // add holes to the room geo
        const holes = room.data.holes;
        if (holes !== null && holes.length !== 0) {
            for (let i = 0; i < holes.length; i++) {
                const holePath = holes[i];
                addPathToGeo(holePath);
            }
        }
        // add fig to geo
        if (fig !== null) {
            geo.add(fig);
        }
        geo.normalize();
        shape.geometry = geo;
        let smallestX = Number.MAX_VALUE;
        let smallestY = Number.MAX_VALUE;
        for (let i = 0; i < pts.length; i++) {
            const pt = pts[i];
            if (pt.x < smallestX) {
                smallestX = pt.x;
            }
            if (pt.y < smallestY) {
                smallestY = pt.y;
            }
        }
        // find smallest x and y values of all points and set that to the position of the room node
        room.position = new go.Point(smallestX, smallestY);
        room.location = new go.Point(smallestX, smallestY);
        fp.model.setDataProperty(room.data, 'loc', new go.Point(smallestX, smallestY));
        // also update room area in data
        const area = fp.getRoomArea(room);
        fp.model.setDataProperty(room.data, 'area', area);
    }
    /**
     * Helper function for Build Dimension Link: get a to/from point for a Dimension Link
     * @param {go.Group} wall The Wall Group being given a Dimension Link
     * @param {number} angle The angle of "wall"
     * @param {number} wallOffset The distance the Dimension Link will be from wall (in pixels)
     * @return {go.Point}
     */
    getAdjustedPoint(point, wall, angle, wallOffset) {
        const oldPoint = point.copy();
        point.offset(0, -(wall.data.thickness * 0.5) - wallOffset);
        point.offset(-oldPoint.x, -oldPoint.y).rotate(angle).offset(oldPoint.x, oldPoint.y);
        return point;
    }
    /**
     * Helper function for Update Wall Dimensions; used to build Dimension Links
     * @param {go.Group} wall The wall the Link runs along (either describing the wall itself or some wallPart on "wall")
     * @param {number} index A number appended to PointNode keys; used for finding PointNodes of Dimension Links later
     * @param {go.Point} point1 The first point of the wallPart being described by the Link
     * @param {go.Point} point2 The second point of the wallPart being described by the Link
     * @param {number} angle The angle of the wallPart
     * @param {number} wallOffset How far from the wall (in px) the Link should be
     * @param {boolean} soloWallFlag If this Link is the only Dimension Link for "wall" (no other wallParts on "wall" selected) this is true; else, false
     * @param {Floorplan} floorplan A reference to a valid Floorplan
     * @param {number} miteringSide The mitering side of the wall we're labelling with a dimension link. Can be 1 or 2
     * @param {number} opacity How opaque the link is. Optional. Default is 1
     * @param {string} stroke The stroke color for the link. Optional. Default is gray
     * @param {number} strokeWidth The stroke width for the link. Optional. Default is 2.
     */
    buildDimensionLink(wall, index, point1, point2, angle, wallOffset, soloWallFlag, floorplan, miteringSide, opacity, stroke, strokeWidth) {
        point1 = floorplan.getAdjustedPoint(point1, wall, angle, wallOffset);
        point2 = floorplan.getAdjustedPoint(point2, wall, angle, wallOffset);
        if (opacity === undefined || opacity === null || isNaN(opacity)) {
            opacity = 1;
        }
        if (strokeWidth === undefined || strokeWidth === null || isNaN(strokeWidth)) {
            strokeWidth = 2;
        }
        if (stroke === undefined || stroke === null) {
            stroke = 'gray';
        }
        const data1 = {
            key: wall.data.key + 'PointNode' + miteringSide + index,
            category: 'PointNode',
            loc: go.Point.stringify(point1),
        };
        const data2 = {
            key: wall.data.key + 'PointNode' + miteringSide + (index + 1),
            category: 'PointNode',
            loc: go.Point.stringify(point2),
        };
        const data3 = {
            key: wall.data.key + 'DimensionLink',
            category: 'DimensionLink',
            from: data1.key,
            to: data2.key,
            angle: angle,
            wall: wall.data.key,
            soloWallFlag: soloWallFlag,
        };
        const pointNode1 = makePointNode();
        const pointNode2 = makePointNode();
        const link = makeDimensionLink(opacity, stroke, strokeWidth);
        floorplan.pointNodes.add(pointNode1);
        floorplan.pointNodes.add(pointNode2);
        floorplan.dimensionLinks.add(link);
        floorplan.add(pointNode1);
        floorplan.add(pointNode2);
        floorplan.add(link);
        pointNode1.data = data1;
        pointNode2.data = data2;
        link.data = data3;
        link.fromNode = pointNode1;
        link.toNode = pointNode2;
        link.data.length = Math.sqrt(pointNode1.location.distanceSquaredPoint(pointNode2.location));
    }
    /**
     * Update Dimension Links shown along walls, based on which walls and wallParts are selected
     * @param {go.Set<go.Group>} wallsToDisplayFor An optional set of walls to show dimensions for. If this is not provided,
     *  just show dimensions for selected walls.
     */
    updateWallDimensions(wallsToDisplayFor) {
        const floorplan = this;
        floorplan.skipsUndoManager = true;
        floorplan.startTransaction('update wall dimensions');
        // if showWallLengths === false, remove all pointNodes (used to build wall dimensions)
        if (!floorplan.model.modelData.preferences.showWallLengths) {
            floorplan.pointNodes.iterator.each(function (node) {
                floorplan.remove(node);
            });
            floorplan.dimensionLinks.iterator.each(function (link) {
                floorplan.remove(link);
            });
            floorplan.pointNodes.clear();
            floorplan.dimensionLinks.clear();
            floorplan.commitTransaction('update wall dimensions');
            floorplan.skipsUndoManager = false;
            return;
        }
        // destroy all previous pointNodes and dimensionLinks
        floorplan.pointNodes.iterator.each(function (node) {
            floorplan.remove(node);
        });
        floorplan.dimensionLinks.iterator.each(function (link) {
            floorplan.remove(link);
        });
        floorplan.pointNodes.clear();
        floorplan.dimensionLinks.clear();
        // make visible all dimension links (zero-length dimension links are set to invisible at the end of the function)
        // floorplan.dimensionLinks.iterator.each(function (link) { link.visible = true; });
        const selection = wallsToDisplayFor !== null && wallsToDisplayFor !== undefined
            ? wallsToDisplayFor
            : floorplan.selection;
        // const selection: go.Set<go.Part> = floorplan.selection;
        // gather all selected walls, including walls of selected DoorNodes and WindowNodes
        const walls = new go.Set();
        selection.iterator.each(function (part) {
            if ((part.category === 'WindowNode' || part.category === 'DoorNode') &&
                part.containingGroup !== null) {
                walls.add(part.containingGroup);
            }
            if (part.category === 'WallGroup' &&
                part.data &&
                part.data.startpoint &&
                part.data.endpoint) {
                // ensure there are no parts on this wall that are also selected
                const wall = part;
                let areWallPartsSelected = false;
                wall.memberParts.each(function (wp) {
                    if (wp.isSelected) {
                        areWallPartsSelected = true;
                    }
                });
                if (!areWallPartsSelected) {
                    const ang = wall.data.startpoint.directionPoint(wall.data.endpoint);
                    // build dimension link for side1
                    const s1 = wall.data.smpt1;
                    const e1 = wall.data.empt1;
                    let first = s1.x + s1.y <= e1.x + e1.y ? s1 : e1;
                    let second = s1.x + s1.y > e1.x + e1.y ? s1 : e1;
                    floorplan.buildDimensionLink(wall, 1, first.copy(), second.copy(), (ang + 180) % 360, 10, true, floorplan, 1);
                    const s2 = wall.data.smpt2;
                    const e2 = wall.data.empt2;
                    first = s2.x + s2.y <= e2.x + e2.y ? s2 : e2;
                    second = s2.x + s2.y > e2.x + e2.y ? s2 : e2;
                    floorplan.buildDimensionLink(wall, 2, first.copy(), second.copy(), ang, 10, true, floorplan, 1);
                }
            }
        });
        // create array of selected wall endpoints and selected wallPart endpoints along the wall that represent measured stretches
        walls.iterator.each(function (wall) {
            for (let i = 1; i < 3; i++) {
                const startpoint = wall.data['smpt' + i];
                const endpoint = wall.data['empt' + i];
                const firstWallPt = startpoint.x + startpoint.y <= endpoint.x + endpoint.y ? startpoint : endpoint;
                const lastWallPt = startpoint.x + startpoint.y > endpoint.x + endpoint.y ? startpoint : endpoint;
                let angle = wall.data.startpoint.directionPoint(wall.data.endpoint);
                if (i === 1) {
                    angle = (angle + 180) % 360;
                }
                // store all endpoints along with the part they correspond to (used later to either create DimensionLinks or simply adjust them)
                const wallPartEndpoints = new Array();
                wall.memberParts.iterator.each(function (wallPart) {
                    if (wallPart.isSelected) {
                        const endpoints = getWallPartEndpoints(wallPart);
                        const ep1 = endpoints[0];
                        const ep2 = endpoints[1];
                        const newEp1 = floorplan.rotateAndTranslatePoint(ep1, angle + 0, wall.data.thickness / 2);
                        const newEp2 = floorplan.rotateAndTranslatePoint(ep2, angle + 0, wall.data.thickness / 2);
                        // const newEp1: go.Point = ep1.projectOntoLineSegmentPoint(startpoint, endpoint);
                        // const newEp2: go.Point = ep2.projectOntoLineSegmentPoint(startpoint, endpoint);
                        wallPartEndpoints.push(ep1);
                        wallPartEndpoints.push(ep2);
                    }
                });
                // sort all wallPartEndpoints by x coordinate left to right/ up to down
                wallPartEndpoints.sort(function (a, b) {
                    if (a.x + a.y > b.x + b.y)
                        return 1;
                    if (a.x + a.y < b.x + b.y)
                        return -1;
                    else
                        return 0;
                });
                wallPartEndpoints.unshift(firstWallPt);
                wallPartEndpoints.push(lastWallPt);
                let k = 1; // k is a counter for the indices of PointNodes
                // build / edit dimension links for each stretch, defined by pairs of points in wallPartEndpoints
                for (let j = 0; j < wallPartEndpoints.length - 1; j++) {
                    let linkPoint1 = null;
                    let linkPoint2 = null;
                    const itr = floorplan.pointNodes.iterator;
                    while (itr.next()) {
                        const node = itr.value;
                        if (node.data.key === wall.data.key + 'PointNode' + k) {
                            linkPoint1 = node;
                        }
                        if (node.data.key === wall.data.key + 'PointNode' + (k + 1)) {
                            linkPoint2 = node;
                        }
                    }
                    if (linkPoint1 !== null && linkPoint2 !== null) {
                        const newLoc1 = floorplan.getAdjustedPoint(wallPartEndpoints[j].copy(), wall, angle, 15);
                        const newLoc2 = floorplan.getAdjustedPoint(wallPartEndpoints[j + 1].copy(), wall, angle, 15);
                        linkPoint1.data.loc = go.Point.stringify(newLoc1);
                        linkPoint2.data.loc = go.Point.stringify(newLoc2);
                        linkPoint1.updateTargetBindings();
                        linkPoint2.updateTargetBindings();
                    }
                    else {
                        floorplan.buildDimensionLink(wall, k, wallPartEndpoints[j].copy(), wallPartEndpoints[j + 1].copy(), angle, 15, false, floorplan, i, 0.5, 'gray', 1);
                    }
                    k += 2;
                }
                // total wall Dimension Link constructed of a kth and k+1st pointNode
                let totalWallDimensionLink = null;
                floorplan.dimensionLinks.iterator.each(function (link) {
                    if (link.fromNode !== null &&
                        link.toNode !== null &&
                        link.fromNode.data.key === wall.data.key + 'PointNode' + i + k &&
                        link.toNode.data.key === wall.data.key + 'PointNode' + i + (k + 1)) {
                        totalWallDimensionLink = link;
                    }
                });
                // if a total wall Dimension Link already exists, adjust its constituent point nodes
                if (totalWallDimensionLink !== null) {
                    let linkPoint1 = null;
                    let linkPoint2 = null;
                    const itr = floorplan.pointNodes.iterator;
                    while (itr.next()) {
                        const node = itr.value;
                        if (node.data.key === wall.data.key + 'PointNode' + k) {
                            linkPoint1 = node;
                        }
                        if (node.data.key === wall.data.key + 'PointNode' + (k + 1)) {
                            linkPoint2 = node;
                        }
                    }
                    if (linkPoint1 !== null && linkPoint2 !== null) {
                        const newLoc1 = floorplan.getAdjustedPoint(wallPartEndpoints[0].copy(), wall, angle, 25);
                        const newLoc2 = floorplan.getAdjustedPoint(wallPartEndpoints[wallPartEndpoints.length - 1].copy(), wall, angle, 25);
                        linkPoint1.data.loc = go.Point.stringify(newLoc1);
                        linkPoint2.data.loc = go.Point.stringify(newLoc2);
                        linkPoint1.updateTargetBindings();
                        linkPoint2.updateTargetBindings();
                    }
                }
                else {
                    floorplan.buildDimensionLink(wall, k, wallPartEndpoints[0].copy(), wallPartEndpoints[wallPartEndpoints.length - 1].copy(), angle, 25, false, floorplan, i);
                }
            } // end for loop (ensures both sides of the wall are dimensioned)
        });
        // Cleanup: hide zero-length Dimension Links, DimensionLinks with null wall points
        floorplan.dimensionLinks.iterator.each(function (link) {
            let canStay = false;
            floorplan.pointNodes.iterator.each(function (node) {
                if (node.data.key === link.data.to)
                    canStay = true;
            });
            if (!canStay)
                floorplan.remove(link);
            else {
                if (link !== null && link.toNode !== null && link.fromNode !== null) {
                    const length = Math.sqrt(link.toNode.location.distanceSquaredPoint(link.fromNode.location));
                    if (length < 1 && !link.data.soloWallFlag)
                        link.visible = false;
                }
            }
        });
        floorplan.commitTransaction('update wall dimensions');
        floorplan.skipsUndoManager = false;
    } // end updateWallDimensions()
    /**
     * @param {go.Point} pt
     * @param {number} angle
     * @param {number} distance
     */
    rotateAndTranslatePoint(pt, angle, distance) {
        const x = pt.x;
        const y = pt.y;
        const newX = Math.cos((x * Math.PI) / 180) * distance + x;
        const newY = Math.sin((x * Math.PI) / 180) * distance + y;
        const newPt = new go.Point(newX, newY);
        return newPt;
    }
    /**
     * Return the point where two walls intersect. If they do not intersect, return null.
     * @param {go.Group} w1
     * @param {go.Group} w2
     * @return {go.Point | null}
     */
    getWallsIntersection(w1, w2) {
        if (w1 === null || w2 === null) {
            return null;
        }
        const x1 = w1.data.startpoint.x;
        const y1 = w1.data.startpoint.y;
        const x2 = w1.data.endpoint.x;
        const y2 = w1.data.endpoint.y;
        const x3 = w2.data.startpoint.x;
        const y3 = w2.data.startpoint.y;
        const x4 = w2.data.endpoint.x;
        const y4 = w2.data.endpoint.y;
        // Check if none of the lines are of length 0
        if ((x1 === x2 && y1 === y2) || (x3 === x4 && y3 === y4)) {
            return null;
        }
        const denominator = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
        /**
         * Returns whether or not 2 points are "close enough" to each other
         * @param {go.Point} p1
         * @param {go.Point} p2
         * @return {boolean}
         */
        function pointsApproximatelyEqual(p1, p2) {
            const xa = p1.x;
            const xb = p2.x;
            const ya = p1.y;
            const yb = p2.y;
            const diff1 = Math.abs(xb - xa);
            const diff2 = Math.abs(yb - ya);
            if (diff2 < 0.05 && diff1 < 0.05) {
                return true;
            }
            return false;
        }
        // Lines are parallel -- edge case, endpoint-endpoint connection of parallel walls
        if (denominator === 0) {
            // Edge Case: wall1 and wall2 have an endpoint to endpoint intersection (the only instance in which paralell walls could intersect at a specific point)
            if (pointsApproximatelyEqual(w1.data.startpoint, w2.data.startpoint) ||
                pointsApproximatelyEqual(w1.data.startpoint, w2.data.endpoint))
                return w1.data.startpoint;
            if (pointsApproximatelyEqual(w1.data.endpoint, w2.data.startpoint) ||
                pointsApproximatelyEqual(w1.data.endpoint, w2.data.endpoint))
                return w1.data.endpoint;
            return null;
        }
        const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denominator;
        const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denominator;
        const ua1 = +ua.toFixed(2);
        const ub1 = +ub.toFixed(2);
        // is the intersection along the segments
        if (ua1 < 0 || ua1 > 1 || ub1 < 0 || ub1 > 1) {
            return null;
        }
        // Return a object with the x and y coordinates of the intersection
        const x = x1 + ua * (x2 - x1);
        const y = y1 + ua * (y2 - y1);
        return new go.Point(x, y);
    }
    /**
     * Return the intersection point of two segments
     * @param {go.Point} p1 Seg 1 point 1
     * @param {go.Point} p2 Seg 1 point 2
     * @param {go.Point} p3 Seg 2 point 1
     * @param {go.Point} p4 Seg 2 point 2
     * @return {go.Point | null}
     */
    getSegmentsIntersection(p1, p2, p3, p4) {
        const x1 = p1.x;
        const y1 = p1.y;
        const x2 = p2.x;
        const y2 = p2.y;
        const x3 = p3.x;
        const y3 = p3.y;
        const x4 = p4.x;
        const y4 = p4.y;
        // Check if none of the lines are of length 0
        if ((x1 === x2 && y1 === y2) || (x3 === x4 && y3 === y4)) {
            return null;
        }
        const denominator = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
        /**
         * Returns whether or not 2 points are "close enough" to each other
         * @param {go.Point} pa
         * @param {go.Point} pb
         * @return {boolean}
         */
        function pointsApproximatelyEqual(pa, pb) {
            const xa = pa.x;
            const xb = pb.x;
            const ya = pa.y;
            const yb = pb.y;
            const diff1 = Math.abs(xb - xa);
            const diff2 = Math.abs(yb - ya);
            if (diff2 < 0.05 && diff1 < 0.05) {
                return true;
            }
            return false;
        }
        // Lines are parallel -- edge case, endpoint-endpoint connection of parallel walls
        if (denominator === 0) {
            // Edge Case: wall1 and wall2 have an endpoint to endpoint intersection (the only instance in which paralell walls could intersect at a specific point)
            if (pointsApproximatelyEqual(p1, p3) || pointsApproximatelyEqual(p1, p4))
                return p1;
            if (pointsApproximatelyEqual(p2, p3) || pointsApproximatelyEqual(p2, p4))
                return p2;
            return null;
        }
        const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denominator;
        const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denominator;
        const ua1 = +ua.toFixed(4);
        const ub1 = +ub.toFixed(4);
        // is the intersection along the segments
        if (ua1 < 0 || ua1 > 1 || ub1 < 0 || ub1 > 1) {
            return null;
        }
        // Return a object with the x and y coordinates of the intersection
        const x = x1 + ua * (x2 - x1);
        const y = y1 + ua * (y2 - y1);
        return new go.Point(x, y);
    }
    /**
     * Update Angle Nodes shown along a wall, based on which wall(s) is/are selected
     */
    updateWallAngles() {
        const floorplan = this;
        floorplan.skipsUndoManager = true; // do not store displaying angles as a transaction
        floorplan.startTransaction('display angles');
        if (floorplan.model.modelData.preferences.showWallAngles) {
            floorplan.angleNodes.iterator.each(function (node) {
                node.visible = true;
            });
            const selectedWalls = new Array();
            floorplan.selection.iterator.each(function (part) {
                if (part.category === 'WallGroup') {
                    const w = part;
                    selectedWalls.push(w);
                }
            });
            for (let i = 0; i < selectedWalls.length; i++) {
                const seen = new go.Set(); // Set of all walls "seen" thus far for "wall"
                const wall = selectedWalls[i];
                const possibleWalls = floorplan.findNodesByExample({
                    category: 'WallGroup',
                });
                // go through all other walls; if the other wall intersects this wall, make angles
                possibleWalls.iterator.each(function (otherWall) {
                    if (otherWall.data === null || wall.data === null || seen.contains(otherWall.data.key))
                        return;
                    if (otherWall.data.key !== wall.data.key &&
                        floorplan.getWallsIntersection(wall, otherWall) !== null &&
                        !seen.contains(otherWall.data.key)) {
                        seen.add(otherWall.data.key);
                        // "otherWall" intersects "wall"; make or update angle nodes
                        const intersectionPoint = floorplan.getWallsIntersection(wall, otherWall);
                        if (intersectionPoint !== null) {
                            const wrt = floorplan.toolManager.mouseDownTools.elt(3);
                            const wallsInvolved = wrt.getAllWallsAtIntersection(intersectionPoint);
                            const endpoints = new Array(); // store endpoints and their corresponding walls here
                            // gather endpoints of each wall in wallsInvolved; discard endpoints within a tolerance distance of intersectionPoint
                            wallsInvolved.iterator.each(function (w) {
                                const tolerance = floorplan.model.modelData.gridSize >= 10
                                    ? floorplan.model.modelData.gridSize
                                    : 10;
                                if (Math.sqrt(w.data.startpoint.distanceSquaredPoint(intersectionPoint)) > tolerance)
                                    endpoints.push({ point: w.data.startpoint, wall: w.data.key });
                                if (Math.sqrt(w.data.endpoint.distanceSquaredPoint(intersectionPoint)) > tolerance)
                                    endpoints.push({ point: w.data.endpoint, wall: w.data.key });
                            });
                            // find maxRadius (shortest distance from an involved wall's endpoint to intersectionPoint or 30, whichever is smaller)
                            let maxRadius = 30;
                            for (let j = 0; j < endpoints.length; j++) {
                                const distance = Math.sqrt(endpoints[j].point.distanceSquaredPoint(intersectionPoint));
                                if (distance < maxRadius)
                                    maxRadius = distance;
                            }
                            // sort endpoints in a clockwise fashion around the intersectionPoint
                            endpoints.sort(function (a, b) {
                                a = a.point;
                                b = b.point;
                                if (a.x - intersectionPoint.x >= 0 && b.x - intersectionPoint.x < 0)
                                    return 1;
                                if (a.x - intersectionPoint.x < 0 && b.x - intersectionPoint.x >= 0)
                                    return -1;
                                if (a.x - intersectionPoint.x === 0 && b.x - intersectionPoint.x === 0) {
                                    if (a.y - intersectionPoint.y >= 0 || b.y - intersectionPoint.y >= 0)
                                        return a.y > b.y ? 1 : -1;
                                    return b.y > a.y ? 1 : -1;
                                }
                                // compute the cross product of vectors (center -> a) x (center -> b)
                                const det = (a.x - intersectionPoint.x) * (b.y - intersectionPoint.y) -
                                    (b.x - intersectionPoint.x) * (a.y - intersectionPoint.y);
                                if (det < 0)
                                    return 1;
                                if (det > 0)
                                    return -1;
                                // points a and b are on the same line from the center; check which point is closer to the center
                                const d1 = (a.x - intersectionPoint.x) * (a.x - intersectionPoint.x) +
                                    (a.y - intersectionPoint.y) * (a.y - intersectionPoint.y);
                                const d2 = (b.x - intersectionPoint.x) * (b.x - intersectionPoint.x) +
                                    (b.y - intersectionPoint.y) * (b.y - intersectionPoint.y);
                                return d1 > d2 ? 1 : -1;
                            }); // end endpoints sort
                            // for each pair of endpoints, construct or modify an angleNode
                            for (let j = 0; j < endpoints.length; j++) {
                                const p1 = endpoints[j];
                                let p2;
                                if (endpoints[j + 1] != null) {
                                    p2 = endpoints[j + 1];
                                }
                                else {
                                    p2 = endpoints[0];
                                }
                                const a1 = intersectionPoint.directionPoint(p1.point);
                                const a2 = intersectionPoint.directionPoint(p2.point);
                                const sweep = Math.abs(a2 - a1 + 360) % 360;
                                const angle = a1;
                                //    construct proper key for angleNode
                                //    proper angleNode key syntax is "wallWwallX...wallYangleNodeZ" such that W < Y < Y; angleNodes are sorted clockwise around the intersectionPoint by Z
                                const keyArray = new Array(); // used to construct proper key
                                wallsInvolved.iterator.each(function (w) {
                                    keyArray.push(w);
                                });
                                keyArray.sort(function (a, b) {
                                    const aIndex = a.data.key.match(/\d+/g);
                                    const bIndex = b.data.key.match(/\d+/g);
                                    if (isNaN(aIndex))
                                        return 1;
                                    if (isNaN(bIndex))
                                        return -1;
                                    else
                                        return aIndex > bIndex ? 1 : -1;
                                });
                                let key = '';
                                for (let k = 0; k < keyArray.length; k++)
                                    key += keyArray[k].data.key;
                                key += 'angle' + j;
                                // check if this angleNode already exists -- if it does, adjust data (instead of deleting/redrawing)
                                let angleNode = null;
                                const aitr = floorplan.angleNodes.iterator;
                                while (aitr.next()) {
                                    const aNode = aitr.value;
                                    if (aNode.data.key === key) {
                                        angleNode = aNode;
                                    }
                                }
                                if (angleNode !== null) {
                                    angleNode.data.angle = angle;
                                    angleNode.data.sweep = sweep;
                                    angleNode.data.loc = go.Point.stringify(intersectionPoint);
                                    angleNode.data.maxRadius = maxRadius;
                                    angleNode.updateTargetBindings();
                                }
                                else {
                                    const data = {
                                        key: key,
                                        category: 'AngleNode',
                                        loc: go.Point.stringify(intersectionPoint),
                                        stroke: 'dodgerblue',
                                        angle: angle,
                                        sweep: sweep,
                                        maxRadius: maxRadius,
                                    };
                                    const newAngleNode = makeAngleNode();
                                    newAngleNode.data = data;
                                    floorplan.add(newAngleNode);
                                    newAngleNode.updateTargetBindings();
                                    floorplan.angleNodes.add(newAngleNode);
                                }
                            }
                        } // end intersectionPt null check
                    }
                });
            }
            // garbage collection (angleNodes that should not exist any more)
            const garbage = new Array();
            floorplan.angleNodes.iterator.each(function (node) {
                const keyNums = node.data.key.match(/\d+/g); // values X for all wall keys involved, given key "wallX"
                const numWalls = (node.data.key.match(/wall/g) || new Array()).length; // # of walls involved in in "node"'s construction
                const wallsInvolved = new Array();
                // add all walls involved in angleNode's construction to wallsInvolved
                for (let i = 0; i < keyNums.length - 1; i++) {
                    wallsInvolved.push('wall' + keyNums[i]);
                }
                // edge case: if the numWalls != keyNums.length, that means the wall with key "wall" (no number in key) is involved
                if (numWalls !== keyNums.length - 1) {
                    wallsInvolved.push('wall');
                }
                // Case 1: if any wall pairs involved in this angleNode are no longer intersecting, add this angleNode to "garbage"
                for (let i = 0; i < wallsInvolved.length - 1; i++) {
                    const wall1 = floorplan.findPartForKey(wallsInvolved[i]);
                    const wall2 = floorplan.findPartForKey(wallsInvolved[i + 1]);
                    const intersectionPoint = floorplan.getWallsIntersection(wall1, wall2);
                    if (intersectionPoint === null)
                        garbage.push(node);
                }
                // Case 2: if there are angleNode clusters with the same walls in their keys as "node" but different locations, destroy and rebuild
                // collect all angleNodes with same walls in their construction as "node"
                const possibleAngleNodes = new go.Set();
                const allWalls = node.data.key.slice(0, node.data.key.indexOf('angle'));
                floorplan.angleNodes.iterator.each(function (other) {
                    if (other.data.key.indexOf(allWalls) !== -1)
                        possibleAngleNodes.add(other);
                });
                possibleAngleNodes.iterator.each(function (pNode) {
                    if (pNode.data.loc !== node.data.loc) {
                        garbage.push(pNode);
                    }
                });
                // Case 3: put any angleNodes with sweep === 0 in garbage
                if (node.data.sweep === 0)
                    garbage.push(node);
            });
            for (let i = 0; i < garbage.length; i++) {
                floorplan.remove(garbage[i]); // remove garbage
                floorplan.angleNodes.remove(garbage[i]);
            }
        }
        // hide all angles > 180 if show only small angles == true in preferences
        if (floorplan.model.modelData.preferences.showOnlySmallWallAngles) {
            floorplan.angleNodes.iterator.each(function (node) {
                if (node.data.sweep >= 180)
                    node.visible = false;
            });
        }
        // hide all angles if show wall angles == false in preferences
        if (!floorplan.model.modelData.preferences.showWallAngles) {
            floorplan.angleNodes.iterator.each(function (node) {
                node.visible = false;
            });
        }
        floorplan.commitTransaction('display angles');
        floorplan.skipsUndoManager = false;
    }
    /**
     * Find closest loc (to a wall part's loc) on wall a wallPart can be dropped onto without extending beyond wall endpoints or intruding into another wallPart
     * @param {go.Group} wall A reference to a Wall Group
     * @param {go.Part} part A reference to a Wall Part Node -- i.e. Door Node, Window Node
     * @return {go.Point}
     */
    findClosestLocOnWall(wall, part) {
        let orderedConstrainingPts = new Array(); // wall endpoints and wallPart endpoints
        const startpoint = wall.data.startpoint.copy();
        const endpoint = wall.data.endpoint.copy();
        // store all possible constraining endpoints (wall endpoints and wallPart endpoints) in the order in which they appear (left/top to right/bottom)
        const firstWallPt = startpoint.x + startpoint.y <= endpoint.x + endpoint.y ? startpoint : endpoint;
        const lastWallPt = startpoint.x + startpoint.y > endpoint.x + endpoint.y ? startpoint : endpoint;
        const wallPartEndpoints = new Array();
        wall.memberParts.iterator.each(function (wallPart) {
            const endpoints = getWallPartEndpoints(wallPart);
            wallPartEndpoints.push(endpoints[0]);
            wallPartEndpoints.push(endpoints[1]);
        });
        // sort all wallPartEndpoints by x coordinate left to right
        wallPartEndpoints.sort(function (a, b) {
            if (a.x + a.y > b.x + b.y) {
                return 1;
            }
            if (a.x + a.y < b.x + b.y) {
                return -1;
            }
            else {
                return 0;
            }
        });
        orderedConstrainingPts.push(firstWallPt);
        orderedConstrainingPts = orderedConstrainingPts.concat(wallPartEndpoints);
        orderedConstrainingPts.push(lastWallPt);
        // go through all constraining points; if there's a free stretch along the wall "part" could fit in, remember it
        const possibleStretches = new Array();
        for (let i = 0; i < orderedConstrainingPts.length; i += 2) {
            const point1 = orderedConstrainingPts[i];
            const point2 = orderedConstrainingPts[i + 1];
            const distanceBetween = Math.sqrt(point1.distanceSquaredPoint(point2));
            if (distanceBetween >= part.data.length) {
                possibleStretches.push({ pt1: point1, pt2: point2 });
            }
        }
        // go through all possible stretches along the wall the part *could* fit in; find the one closest to the part's current location
        let closestDist = Number.MAX_VALUE;
        let closestStretch = null;
        for (let i = 0; i < possibleStretches.length; i++) {
            const testStretch = possibleStretches[i];
            const testPoint1 = testStretch.pt1;
            const testPoint2 = testStretch.pt2;
            const testDistance1 = Math.sqrt(testPoint1.distanceSquaredPoint(part.location));
            const testDistance2 = Math.sqrt(testPoint2.distanceSquaredPoint(part.location));
            if (testDistance1 < closestDist) {
                closestDist = testDistance1;
                closestStretch = testStretch;
            }
            if (testDistance2 < closestDist) {
                closestDist = testDistance2;
                closestStretch = testStretch;
            }
        }
        // Edge Case: If there's no space for the wallPart, return null
        if (closestStretch === null) {
            return null;
        }
        // using the closest free stretch along the wall, calculate endpoints that make the stretch's line segment, then project part.location onto the segment
        const closestStretchLength = Math.sqrt(closestStretch.pt1.distanceSquaredPoint(closestStretch.pt2));
        const offset = part.data.length / 2;
        const pt1 = new go.Point(closestStretch.pt1.x +
            (offset / closestStretchLength) * (closestStretch.pt2.x - closestStretch.pt1.x), closestStretch.pt1.y +
            (offset / closestStretchLength) * (closestStretch.pt2.y - closestStretch.pt1.y));
        const pt2 = new go.Point(closestStretch.pt2.x +
            (offset / closestStretchLength) * (closestStretch.pt1.x - closestStretch.pt2.x), closestStretch.pt2.y +
            (offset / closestStretchLength) * (closestStretch.pt1.y - closestStretch.pt2.y));
        const newLoc = part.location.copy().projectOntoLineSegmentPoint(pt1, pt2);
        return newLoc;
    }
} // end Floorplan class definition
/*
 * Copyright 1998-2025 by Northwoods Software Corporation
 * All Rights Reserved.
 *
 * FLOOR PLANNER CODE: TEMPLATES - GENERAL
 * General GraphObject templates used in the Floor Planner sample
 * Includes Context Menu, Diagram, Default Group, AngleNode, DimensionLink, PointNode
 */
/*
 * Dependencies for Context Menu:
 * Make Selection Group, Ungroup Selection, Clear Empty Groups
 */
// Make the selection a group
function makeSelectionGroup(floorplan) {
    floorplan.startTransaction('group selection');
    // ungroup all selected nodes; then group them; if one of the selected nodes is a group, ungroup all its nodes
    const sel = floorplan.selection;
    const nodes = new Array();
    sel.iterator.each(function (n) {
        if (n instanceof go.Group) {
            n.memberParts.iterator.each(function (part) {
                nodes.push(part);
            });
        }
        else {
            nodes.push(n);
        }
    });
    for (let i = 0; i < nodes.length; i++) {
        nodes[i].isSelected = true;
    }
    ungroupSelection(floorplan);
    floorplan.commandHandler.groupSelection();
    const group = floorplan.selection.first(); // after grouping, the new group will be the only thing selected
    if (group !== null) {
        floorplan.model.setDataProperty(group.data, 'caption', 'Group');
        floorplan.model.setDataProperty(group.data, 'notes', '');
    }
    clearEmptyGroups(floorplan);
    // unselect / reselect group so data appears properly in Selection Info Window
    floorplan.clearSelection();
    floorplan.select(group);
    floorplan.commitTransaction('group selection');
}
// Ungroup selected nodes; if the selection is a group, ungroup all it's memberParts
function ungroupSelection(floorplan) {
    floorplan.startTransaction('ungroup selection');
    // helper function to ungroup nodes
    function ungroupNode(node) {
        const group = node.containingGroup;
        node.containingGroup = null;
        if (group !== null) {
            if (group.memberParts.count === 0) {
                floorplan.remove(group);
            }
            else if (group.memberParts.count === 1) {
                const mpf = group.memberParts.first();
                if (mpf !== null) {
                    mpf.containingGroup = null;
                }
            }
        }
    }
    // ungroup any selected nodes; remember groups that are selected
    const sel = floorplan.selection;
    const groups = new Array();
    sel.iterator.each(function (n) {
        if (!(n instanceof go.Group)) {
            ungroupNode(n);
        }
        else {
            groups.push(n);
        }
    });
    // go through selected groups, and ungroup their memberparts too
    const nodes = new Array();
    for (let i = 0; i < groups.length; i++) {
        groups[i].memberParts.iterator.each(function (n) {
            nodes.push(n);
        });
    }
    for (let i = 0; i < nodes.length; i++) {
        ungroupNode(nodes[i]);
    }
    clearEmptyGroups(floorplan);
    floorplan.commitTransaction('ungroup selection');
}
// Clear all the groups that have no nodes
function clearEmptyGroups(floorplan) {
    const nodes = floorplan.nodes;
    const arr = new Array();
    nodes.iterator.each(function (node) {
        if (node instanceof go.Group && node.memberParts.count === 0 && node.category !== 'WallGroup') {
            arr.push(node);
        }
    });
    for (let i = 0; i < arr.length; i++) {
        floorplan.remove(arr[i]);
    }
}
/*
 * General Group Dependencies:
 * Group Tool Tip
 */
// Group Tool Tip
function makeGroupToolTip() {
    const $ = go.GraphObject.make;
    return $(go.Adornment, 'Auto', $(go.Shape, { fill: '#FFFFCC' }), $(go.TextBlock, { margin: 4 }, new go.Binding('text', '', function (text, obj) {
        const data = obj.part.adornedObject.data;
        const name = obj.part.adornedObject.category === 'MultiPurposeNode' ? data.text : data.caption;
        return ('Name: ' +
            name +
            '\nNotes: ' +
            data.notes +
            '\nMembers: ' +
            obj.part.adornedObject.memberParts.count);
    }).ofObject()));
}
/*
 * General Templates:
 * Context Menu, Default Group
 */
// Context Menu -- referenced by Node, Diagram and Group Templates
function makeContextMenu() {
    const $ = go.GraphObject.make;
    return $(go.Adornment, 'Vertical', 
    // Make Room Button
    $('ContextMenuButton', $(go.TextBlock, 'Make Room'), {
        click(e, obj) {
            const fp = e.diagram;
            // const pt: go.Point = obj.part === null ? e.diagram.lastInput.documentPoint : obj.part.location;
            const pt = e.diagram.lastInput.documentPoint;
            fp.maybeAddRoomNode(pt, 'images/textures/floor1.jpg');
        },
    }), 
    // Make group button
    $('ContextMenuButton', $(go.TextBlock, 'Make Group'), {
        click(e, obj) {
            const part = obj.part;
            if (part !== null) {
                const fp = part.diagram;
                makeSelectionGroup(fp);
            }
        },
    }, new go.Binding('visible', 'visible', function (v, obj) {
        const floorplan = obj.part.diagram;
        if (floorplan.selection.count <= 1) {
            return false;
        }
        let flag = true;
        floorplan.selection.iterator.each(function (node) {
            if (node.category === 'WallGroup' ||
                node.category === 'WindowNode' ||
                node.category === 'DoorNode' ||
                node.category === 'RoomNode') {
                flag = false;
            }
        });
        return flag;
    }).ofObject()), 
    // Ungroup Selection Button
    $('ContextMenuButton', $(go.TextBlock, 'Ungroup'), {
        click(e, obj) {
            const part = obj.part;
            if (part !== null) {
                const fp = part.diagram;
                ungroupSelection(fp);
            }
        },
    }, new go.Binding('visible', '', function (v, obj) {
        const floorplan = obj.part.diagram;
        if (floorplan !== null) {
            const node = floorplan.selection.first();
            return ((node instanceof go.Node &&
                node.containingGroup != null &&
                node.containingGroup.category !== 'WallGroup') ||
                (node instanceof go.Group && node.category === ''));
        }
        return false;
    }).ofObject()), 
    // Copy Button
    $('ContextMenuButton', $(go.TextBlock, 'Copy'), {
        click: function (e, obj) {
            const part = obj.part;
            if (part !== null && part.diagram !== null) {
                part.diagram.commandHandler.copySelection();
            }
        },
    }, new go.Binding('visible', '', function (v, obj) {
        if (obj.part.diagram !== null) {
            const sel = obj.part.diagram.selection;
            let flag = sel.count > 0;
            sel.iterator.each(function (p) {
                if (p.category === 'WallGroup' ||
                    p.category === 'WindowNode' ||
                    p.category === 'DoorNode' ||
                    p.category === 'RoomNode') {
                    flag = false;
                }
            });
            return flag;
        }
        return false;
    }).ofObject()), 
    // Cut Button
    $('ContextMenuButton', $(go.TextBlock, 'Cut'), {
        click(e, obj) {
            const part = obj.part;
            if (part !== null && part.diagram !== null) {
                part.diagram.commandHandler.cutSelection();
            }
        },
    }, new go.Binding('visible', '', function (v, obj) {
        if (obj.part.diagram !== null) {
            const sel = obj.part.diagram.selection;
            let flag = sel.count > 0;
            sel.iterator.each(function (p) {
                if (p.category === 'WallGroup' ||
                    p.category === 'WindowNode' ||
                    p.category === 'DoorNode' ||
                    p.category === 'RoomNode') {
                    flag = false;
                }
            });
            return flag;
        }
        return false;
    }).ofObject()), 
    // Delete Button
    $('ContextMenuButton', $(go.TextBlock, 'Delete'), {
        click(e, obj) {
            const part = obj.part;
            if (part !== null && part.diagram !== null) {
                part.diagram.commandHandler.deleteSelection();
            }
        },
    }, new go.Binding('visible', '', function (v, obj) {
        if (obj.part.diagram !== null) {
            return obj.part.diagram.selection.count > 0;
        }
        return false;
    }).ofObject()), 
    // Paste Button
    $('ContextMenuButton', $(go.TextBlock, 'Paste'), {
        click(e, obj) {
            const part = obj.part;
            if (part !== null && part.diagram !== null) {
                part.diagram.commandHandler.pasteSelection(part.diagram.toolManager.contextMenuTool.mouseDownPoint);
            }
        },
    }));
}
// Default Group
function makeDefaultGroup() {
    const $ = go.GraphObject.make;
    return $(go.Group, 'Vertical', {
        contextMenu: makeContextMenu(),
        toolTip: makeGroupToolTip(),
    }, new go.Binding('location', 'loc'), $(go.Panel, 'Auto', $(go.Shape, 'RoundedRectangle', {
        fill: 'rgba(128,128,128,0.15)',
        stroke: 'rgba(128, 128, 128, .05)',
        name: 'SHAPE',
        strokeCap: 'square',
    }, new go.Binding('fill', 'isSelected', function (s, obj) {
        return s ? 'rgba(128, 128, 128, .15)' : 'rgba(128, 128, 128, 0.10)';
    }).ofObject()), $(go.Placeholder, { padding: 5 }) // extra padding around group members
    ));
}
/*
 * Dependencies for Angle Nodes:
 * Make Arc
 */
// Return arc geometry for Angle Nodes
function makeArc(node) {
    const ang = node.data.angle;
    const sweep = node.data.sweep;
    const rad = Math.min(30, node.data.maxRadius);
    if (typeof sweep === 'number' && sweep > 0) {
        const start = new go.Point(rad, 0).rotate(ang);
        // this is much more efficient than calling go.GraphObject.make:
        return new go.Geometry()
            .add(new go.PathFigure(start.x + rad, start.y + rad) // start point
            .add(new go.PathSegment(go.SegmentType.Arc, ang, sweep, // angles
        rad, rad, // center
        rad, rad) // radius
        ))
            .add(new go.PathFigure(0, 0))
            .add(new go.PathFigure(2 * rad, 2 * rad));
    }
    else {
        // make sure this arc always occupies the same circular area of RAD radius
        return new go.Geometry().add(new go.PathFigure(0, 0)).add(new go.PathFigure(2 * rad, 2 * rad));
    }
}
/*
 * Dependencies for Dimension Links
 * Make Point Node
 */
// Return a Point Node (used for Dimension Links)
function makePointNode() {
    const $ = go.GraphObject.make;
    return $(go.Node, 'Position', new go.Binding('location', 'loc', go.Point.parse).makeTwoWay(go.Point.stringify));
}
/*
 * Dynamically appearing parts:
 * Angle Node, Dimension Link
 */
// Return an Angle Node (for each angle ndeeded in the diagram, one angle node is made)
function makeAngleNode() {
    const $ = go.GraphObject.make;
    return $(go.Node, 'Spot', { locationSpot: go.Spot.Center, locationObjectName: 'SHAPE', selectionAdorned: false }, new go.Binding('location', 'loc', go.Point.parse).makeTwoWay(go.Point.stringify), $(go.Shape, 'Circle', // placed where walls intersect, is invisible
    { name: 'SHAPE', height: 0, width: 0 }), $(go.Shape, // arc
    { strokeWidth: 1.5, fill: null }, new go.Binding('geometry', '', makeArc).ofObject(), new go.Binding('stroke', 'sweep', function (sweep) {
        return sweep % 45 < 1 || sweep % 45 > 44 ? 'dodgerblue' : 'lightblue';
    })), 
    // Arc label panel
    $(go.Panel, 'Auto', { name: 'ARCLABEL' }, 
    // position the label in the center of the arc
    new go.Binding('alignment', 'sweep', function (sweep, panel) {
        const rad = Math.min(30, panel.part.data.maxRadius);
        const angle = panel.part.data.angle;
        const cntr = new go.Point(rad, 0).rotate(angle + sweep / 2);
        return new go.Spot(0.5, 0.5, cntr.x, cntr.y);
    }), 
    // rectangle containing angle text
    $(go.Shape, { fill: 'white' }, new go.Binding('stroke', 'sweep', function (sweep) {
        return sweep % 45 < 1 || sweep % 45 > 44 ? 'dodgerblue' : 'lightblue';
    })), 
    // angle text
    $(go.TextBlock, { font: '7pt sans-serif', margin: 2 }, new go.Binding('text', 'sweep', function (sweep) {
        return sweep.toFixed(2) + String.fromCharCode(176);
    }))));
}
/**
 * Returns a Dimension Link
 * @param {number} opacity How opaque the link is, 0-1. Optional. Default is 1.
 * @param {string} stroke The color of the link stroke. Optional. Default is gray.
 * @param {number} strokeWidth The width of the link stroke. Optional. Default is 2.
 */
function makeDimensionLink(opacity, stroke, strokeWidth) {
    if (opacity === null || opacity === undefined || isNaN(opacity)) {
        opacity = 1;
    }
    if (strokeWidth === null || strokeWidth === undefined || isNaN(strokeWidth)) {
        strokeWidth = 2;
    }
    if (stroke === null || stroke === undefined) {
        stroke = 'gray';
    }
    const $ = go.GraphObject.make;
    return $(go.Link, 
    // link itself
    $(go.Shape, { stroke: stroke, strokeWidth: strokeWidth, name: 'SHAPE', opacity: opacity }), 
    // to arrow shape
    $(go.Shape, {
        toArrow: 'OpenTriangle',
        stroke: stroke,
        strokeWidth: strokeWidth,
        opacity: opacity,
    }), $(go.Shape, 
    // from arrow shape
    {
        fromArrow: 'BackwardOpenTriangle',
        stroke: stroke,
        strokeWidth: strokeWidth,
        opacity: opacity,
    }), $(go.Panel, 'Auto', 
    // bind angle of textblock to angle of link -- always make text rightside up and readable
    new go.Binding('angle', 'angle', function (angle, link) {
        if (angle > 90 && angle < 270) {
            return (angle + 180) % 360;
        }
        return angle;
    }), $(go.Shape, 'RoundedRectangle', { fill: 'beige', opacity: 0.8, stroke: null }), 
    // dimension link text
    $(go.TextBlock, { text: 'sometext', segmentOffset: new go.Point(0, -10), font: '13px sans-serif' }, new go.Binding('text', '', function (link) {
        const floorplan = link.diagram;
        const pxDist = link.data.length;
        const unitsDist = floorplan.convertPixelsToUnits(pxDist).toFixed(2);
        const unitsAbbreviation = floorplan.model.modelData.unitsAbbreviation;
        return unitsDist.toString() + unitsAbbreviation;
    }).ofObject(), 
    // default poisiton text above / below dimension link based on angle
    new go.Binding('segmentOffset', 'angle', function (angle, textblock) {
        return new go.Point(0, 10);
    }).ofObject(), 
    // scale font size according to the length of the link
    new go.Binding('font', '', function (link) {
        const distance = link.data.length;
        if (distance > 40) {
            return '13px sans-serif';
        }
        if (distance <= 40 && distance >= 20) {
            return '11px sans-serif';
        }
        else {
            return '9px sans-serif';
        }
    }).ofObject()) // end TextBlock
    ));
}
/*
 * Copyright 1998-2025 by Northwoods Software Corporation
 * All Rights Reserved.
 *
 * FLOOR PLANNER CODE: TEMPLATES - FURNITURE
 * GraphObject templates for interactional furniture nodes (and their dependecies) used in the Floor Planner sample
 * Includes Default Node (Furniture), MultiPurpose Node
 */
/*
 * Furniture Node Dependencies:
 * Node Tool Tip, Furniture Resize Adornment Template, Furniture Rotate Adornment Template, Invert Color
 */
// Node Tool Tip
function makeNodeToolTip() {
    const $ = go.GraphObject.make;
    return $(go.Adornment, 'Auto', $(go.Shape, { fill: '#FFFFCC' }), $(go.TextBlock, { margin: 4 }, new go.Binding('text', '', function (text, obj) {
        const data = obj.part.adornedObject.data;
        const name = obj.part.adornedObject.category === 'MultiPurposeNode' ? data.text : data.caption;
        return 'Name: ' + name + '\nNotes: ' + data.notes;
    }).ofObject()));
}
// Furniture Resize Adornment
function makeFurnitureResizeAdornmentTemplate() {
    const $ = go.GraphObject.make;
    function makeHandle(alignment, cursor) {
        return $(go.Shape, {
            alignment,
            cursor,
            figure: 'Rectangle',
            desiredSize: new go.Size(7, 7),
            fill: 'lightblue',
            stroke: 'dodgerblue',
        }
        /*,
        new go.Binding('fill', 'color'),
        new go.Binding('stroke', 'stroke')*/
        );
    }
    return $(go.Adornment, 'Spot', $(go.Placeholder), makeHandle(go.Spot.Top, 'n-resize'), makeHandle(go.Spot.TopRight, 'n-resize'), makeHandle(go.Spot.BottomRight, 'se-resize'), makeHandle(go.Spot.Right, 'e-resize'), makeHandle(go.Spot.Bottom, 's-resize'), makeHandle(go.Spot.BottomLeft, 'sw-resize'), makeHandle(go.Spot.Left, 'w-resize'), makeHandle(go.Spot.TopLeft, 'nw-resize'));
}
// Furniture Rotate Adornment
function makeFurnitureRotateAdornmentTemplate() {
    const $ = go.GraphObject.make;
    return $(go.Adornment, $(go.Shape, 'Circle', { cursor: 'pointer', desiredSize: new go.Size(7, 7), fill: 'lightblue', stroke: 'dodgerblue' }
    /*new go.Binding('fill', '', function(obj) { return (obj.adornedPart === null) ? '#ffffff' : obj.adornedPart.data.color; }).ofObject(),
    new go.Binding('stroke', '', function(obj) { return (obj.adornedPart === null) ? '#000000' : obj.adornedPart.data.stroke; }).ofObject()*/
    ));
}
/**
 * Return inverted color (in hex) of a given hex code color; used to determine furniture node stroke color
 * @param {string} hex
 * @return {string}
 */
function invertColor(hex) {
    if (hex.indexOf('#') === 0) {
        hex = hex.slice(1);
    }
    // convert 3-digit hex to 6-digits.
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (hex.length !== 6) {
        throw new Error('Invalid HEX color.');
    }
    // invert color components
    const r = (255 - parseInt(hex.slice(0, 2), 16)).toString(16);
    const g = (255 - parseInt(hex.slice(2, 4), 16)).toString(16);
    const b = (255 - parseInt(hex.slice(4, 6), 16)).toString(16);
    // pad each with zeros and return
    return '#' + padZero(r) + padZero(g) + padZero(b);
}
/**
 * @param {string} str
 * @return {string}
 */
function padZero(str) {
    const len = 2;
    const zeros = new Array(len).join('0');
    return (zeros + str).slice(-len);
}
/*
 * Furniture Node Templates:
 * Default Node, MultiPurpose Node
 */
// Default Node
function makeDefaultNode() {
    const $ = go.GraphObject.make;
    return $(go.Node, 'Spot', {
        resizable: true,
        rotatable: true,
        toolTip: makeNodeToolTip(),
        resizeAdornmentTemplate: makeFurnitureResizeAdornmentTemplate(),
        rotateAdornmentTemplate: makeFurnitureRotateAdornmentTemplate(),
        contextMenu: makeContextMenu(),
        locationObjectName: 'SHAPE',
        resizeObjectName: 'SHAPE',
        rotateObjectName: 'SHAPE',
        minSize: new go.Size(5, 5),
        locationSpot: go.Spot.Center,
        selectionAdornmentTemplate: makeTextureSelectionAdornment(null),
    }, 
    // remember Node location
    new go.Binding('location', 'loc', go.Point.parse).makeTwoWay(go.Point.stringify), 
    // move selected Node to Foreground layer so it's not obscuerd by non-selected Parts
    new go.Binding('layerName', 'isSelected', function (s) {
        return s ? 'Foreground' : '';
    }).ofObject(), $(go.Shape, 'Ellipse', {
        name: 'SHAPE',
        stroke: '#000000',
        fill: 'white',
    }, new go.Binding('geometryString', 'geo'), new go.Binding('figure', 'shape').makeTwoWay(), new go.Binding('width').makeTwoWay(), new go.Binding('height').makeTwoWay(), new go.Binding('angle').makeTwoWay(), 
    // either use a texture (Pattern Brush) or color to fill the node
    new go.Binding('fill', 'texture', function (t, obj) {
        return updateNodeTexture(obj, t);
    }), new go.Binding('fill', 'usesTexture', function (usesTexture, obj) {
        const node = obj.part;
        if (node === null)
            return null;
        const t = node.data.texture;
        return updateNodeTexture(obj, t);
    })));
}
// MultiPurpose Node
function makeMultiPurposeNode() {
    const $ = go.GraphObject.make;
    return $(go.Node, 'Spot', {
        contextMenu: makeContextMenu(),
        toolTip: makeNodeToolTip(),
        locationSpot: go.Spot.Center,
        resizeAdornmentTemplate: makeFurnitureResizeAdornmentTemplate(),
        rotateAdornmentTemplate: makeFurnitureRotateAdornmentTemplate(),
        selectionAdornmentTemplate: makeTextureSelectionAdornment(null),
        locationObjectName: 'SHAPE',
        resizable: true,
        rotatable: true,
        resizeObjectName: 'SHAPE',
        rotateObjectName: 'SHAPE',
        minSize: new go.Size(5, 5),
    }, 
    // remember location, angle, height, and width of the node
    new go.Binding('location', 'loc', go.Point.parse).makeTwoWay(go.Point.stringify), 
    // move a selected part into the Foreground layer so it's not obscuerd by non-selected Parts
    new go.Binding('layerName', 'isSelected', function (s) {
        return s ? 'Foreground' : '';
    }).ofObject(), $(go.Shape, { strokeWidth: 1, name: 'SHAPE', fill: 'rgba(128, 128, 128, 0.5)' }, new go.Binding('angle').makeTwoWay(), new go.Binding('width').makeTwoWay(), new go.Binding('height').makeTwoWay(), 
    // either use a texture (Pattern Brush) or color to fill the node
    new go.Binding('fill', 'texture', function (t, obj) {
        return updateNodeTexture(obj, t);
    }), new go.Binding('fill', 'usesTexture', function (usesTexture, obj) {
        const node = obj.part;
        if (node === null)
            return null;
        const t = node.data.texture;
        return updateNodeTexture(obj, t);
    }), new go.Binding('stroke', 'isSelected', function (s, obj) {
        return s ? go.Brush.lightenBy(obj.stroke, 0.5) : invertColor(obj.part.data.color);
    }).ofObject()), $(go.Panel, 'Auto', new go.Binding('visible', 'showLabel'), $(go.Shape, 'RoundedRectangle', { fill: 'beige', opacity: 0.5, stroke: null }), $(go.TextBlock, {
        margin: 5,
        wrap: go.Wrap.Fit,
        textAlign: 'center',
        editable: true,
        isMultiline: false,
        stroke: 'black',
        font: '10pt sans-serif',
    }, new go.Binding('text').makeTwoWay(), new go.Binding('angle', 'angle').makeTwoWay(), new go.Binding('font', 'height', function (height) {
        if (height > 25) {
            return '10pt sans-serif';
        }
        if (height < 25 && height > 15) {
            return '8pt sans-serif';
        }
        else {
            return '6pt sans-serif';
        }
    }))));
}
/**
 * Update the texture of either a multipurpose node or default furniture node based on node data
 * The obj is the Shape element of the node who's 'fill' will be updated
 * This is called in binding conversion functions on 'fill' for Multipurpose nodes and default furniture nodes
 * @param {go.Shape} obj
 * @param {string} t The texture string, or ''
 */
function updateNodeTexture(obj, t) {
    const node = obj.part;
    if (node === null)
        return '';
    if (node.data.usesTexture !== undefined && node.data.usesTexture) {
        if (t === '') {
            return makeTextureBrush(null);
        }
        else {
            const str = t.indexOf('images/textures') === -1 ? 'images/textures/' + t : t;
            return makeTextureBrush(str);
        }
    }
    else {
        if (node.data.color !== undefined) {
            return node.data.color;
        }
        else {
            return 'white';
        }
    }
}
/*
 * Copyright 1998-2025 by Northwoods Software Corporation
 * All Rights Reserved.
 *
 * FLOOR PLANNER CODE: TEMPLATES - WALLS
 * GraphObject templates for Wall Groups, Wall Part Nodes (and their dependecies) used in the Floor Planner sample
 * Includes Wall Group, Palette Wall Node, Window Node, Door Node
 */
/*
 * Wall Group Dependencies:
 * Snap Walls, Find Closest Loc on Wall, Add Wall Part, Wall Part Drag Over, Wall Part Drag Away
 */
/*
* Drag computation function to snap walls to the grid properly while dragging
* @param {Node} part A reference to dragged Part
* @param {Point} pt The Point describing the proposed location
* @param {Point} gridPt Snapped location

var snapWalls = function (part, pt, gridPt) {
    var floorplan = part.diagram;
    floorplan.updateWallDimensions();
    //floorplan.updateWallAngles();
    floorplan.updateWall(part);
    var grid = part.diagram.grid;
    var sPt = part.data.startpoint.copy();
    var ePt = part.data.endpoint.copy();
    var dx = pt.x - part.location.x;
    var dy = pt.y - part.location.y;
    var newSpt = sPt.offset(dx, dy);
    var newEpt = ePt.offset(dx, dy);
    if (floorplan.toolManager.draggingTool.isGridSnapEnabled) {
        newSpt = newSpt.snapToGridPoint(grid.gridOrigin, grid.gridCellSize);
        newEpt = newEpt.snapToGridPoint(grid.gridOrigin, grid.gridCellSize);
    }
    floorplan.model.setDataProperty(part.data, "startpoint", newSpt);
    floorplan.model.setDataProperty(part.data, "endpoint", newEpt);
    return new go.Point((newSpt.x + newEpt.x) / 2, (newSpt.y + newEpt.y) / 2);
}*/
// MouseDrop event for wall groups; if a door or window is dropped on a wall, add it to the wall group
// Do not allow dropping wallParts that would extend beyond wall endpoints or intrude into another wallPart
const addWallPart = function (e, wall) {
    if (!(wall instanceof go.Group))
        return;
    if (wall.data.isDivider)
        return;
    const floorplan = e.diagram;
    const wallPart = floorplan.selection.first();
    if (wallPart &&
        (wallPart.category === 'WindowNode' || wallPart.category === 'DoorNode') &&
        wallPart.containingGroup === null) {
        const newLoc = floorplan.findClosestLocOnWall(wall, wallPart);
        if (newLoc !== null) {
            const shape = wall.findObject('SHAPE');
            shape.stroke = 'black';
            floorplan.model.setDataProperty(wallPart.data, 'group', wall.data.key);
            wallPart.location = newLoc.projectOntoLineSegmentPoint(wall.data.startpoint, wall.data.endpoint);
            wallPart.angle = wall.data.startpoint.directionPoint(wall.data.endpoint);
            if (wallPart.category === 'WindowNode') {
                floorplan.model.setDataProperty(wallPart.data, 'height', wall.data.thickness);
            }
            if (wallPart.category === 'DoorNode') {
                floorplan.model.setDataProperty(wallPart.data, 'doorOpeningHeight', wall.data.thickness);
            }
        }
        else {
            floorplan.remove(wallPart);
            alert("There's not enough room on the wall!");
            return;
        }
    }
    floorplan.updateWallDimensions();
};
// MouseDragEnter event for walls; if a door or window is dragged over a wall, highlight the wall and change its angle
const wallPartDragOver = function (e, wall) {
    if (!(wall instanceof go.Group))
        return;
    if (wall.data.isDivider)
        return;
    const floorplan = e.diagram;
    let draggingParts = floorplan.toolManager.draggingTool.draggedParts;
    if (draggingParts === null) {
        draggingParts = floorplan.toolManager.draggingTool.copiedParts;
    }
    if (draggingParts !== null) {
        draggingParts.iterator.each(function (kvp) {
            const part = kvp.key;
            if ((part.category === 'WindowNode' || part.category === 'DoorNode') &&
                part.containingGroup === null) {
                const shape = wall.findObject('SHAPE');
                shape.stroke = 'lightblue';
                part.angle = wall.rotateObject.angle;
            }
        });
    }
};
// MouseDragLeave event for walls; if a wall part is dragged past a wall, unhighlight the wall and change back the wall part's angle to 0
const wallPartDragAway = function (e, wall) {
    if (!(wall instanceof go.Group))
        return;
    const floorplan = e.diagram;
    const shape = wall.findObject('SHAPE');
    if (shape !== null) {
        shape.stroke = 'black';
        let draggingParts = floorplan.toolManager.draggingTool.draggedParts;
        if (draggingParts === null) {
            draggingParts = floorplan.toolManager.draggingTool.copiedParts;
        }
        if (draggingParts !== null) {
            draggingParts.iterator.each(function (kvp) {
                const part = kvp.key;
                if ((part.category === 'WindowNode' || part.category === 'DoorNode') &&
                    part.containingGroup === null) {
                    part.angle = 0;
                }
            });
        }
    }
};
/*
 * Wall Group Template
 */
// Wall Group
function makeWallGroup() {
    const $ = go.GraphObject.make;
    return $(go.Group, 'Spot', {
        contextMenu: makeContextMenu(),
        toolTip: makeGroupToolTip(),
        selectionObjectName: 'SHAPE',
        rotateObjectName: 'SHAPE',
        locationSpot: go.Spot.TopLeft,
        reshapable: true,
        minSize: new go.Size(1, 1),
        // movable: false,
        selectionAdorned: false,
        mouseDrop: addWallPart,
        mouseDragEnter: wallPartDragOver,
        mouseDragLeave: wallPartDragAway,
        dragComputation: function (part, pt, gridPt) {
            let curLoc = part.location;
            const origLoc = part.location.copy();
            const fp = part.diagram;
            const dt = fp.toolManager.draggingTool;
            // only allow drag if only one wall is selected at a time
            let wallCount = 0;
            fp.selection.iterator.each(function (p) {
                if (p.category === 'WallGroup') {
                    wallCount++;
                    if (p.data.key !== part.data.key) {
                        // p.isSelected = false;
                    }
                }
                if (p.category === 'RoomNode') {
                    p.isSelected = false;
                }
            });
            if (wallCount > 1) {
                return curLoc;
            }
            const gs = fp.grid.gridCellSize;
            gridPt.x -= gs.width / 2;
            gridPt.y -= gs.height / 2;
            const wrt = fp.toolManager.mouseDownTools.elt(3);
            // Generate a map of all walls connected to this wall's endpoints (and at which endpoints those walls are connected at/to)
            const connectedWallsMap = new go.Map();
            const wallsAtStartpoint = wrt.getAllWallsAtIntersection(part.data.startpoint, true);
            wallsAtStartpoint.iterator.each(function (w) {
                if (w.data.key !== part.data.key) {
                    if (wrt.pointsApproximatelyEqual(w.data.startpoint, part.data.startpoint)) {
                        connectedWallsMap.add(w.data.key, {
                            connectedTo: 'startpoint',
                            connectedFrom: 'startpoint',
                        });
                    }
                    else if (wrt.pointsApproximatelyEqual(w.data.endpoint, part.data.startpoint)) {
                        connectedWallsMap.add(w.data.key, {
                            connectedTo: 'startpoint',
                            connectedFrom: 'endpoint',
                        });
                    }
                }
            });
            const wallsAtEndpoint = wrt.getAllWallsAtIntersection(part.data.endpoint, true);
            wallsAtEndpoint.iterator.each(function (w) {
                if (w.data.key !== part.data.key) {
                    if (wrt.pointsApproximatelyEqual(w.data.startpoint, part.data.endpoint)) {
                        connectedWallsMap.add(w.data.key, {
                            connectedTo: 'endpoint',
                            connectedFrom: 'startpoint',
                        });
                    }
                    else if (wrt.pointsApproximatelyEqual(w.data.endpoint, part.data.endpoint)) {
                        connectedWallsMap.add(w.data.key, {
                            connectedTo: 'endpoint',
                            connectedFrom: 'endpoint',
                        });
                    }
                }
            });
            const ptToUse = fp.toolManager.draggingTool.isGridSnapEnabled ? gridPt : pt;
            const wall = part;
            const changedWalls = new go.Set();
            moveAndUpdate(ptToUse);
            /**
             * Helper function -- actually moves wall / connected walls, based on a given point to use as reference
             * @param pointToUse
             */
            function moveAndUpdate(pointToUse) {
                // Offset this wall's startpoint and endpoints
                const dx = pointToUse.x - curLoc.x;
                const dy = pointToUse.y - curLoc.y;
                fp.model.set(part.data, 'startpoint', new go.Point(part.data.startpoint.x + dx, part.data.startpoint.y + dy));
                fp.model.set(part.data, 'endpoint', new go.Point(part.data.endpoint.x + dx, part.data.endpoint.y + dy));
                wrt.performMiteringOnWall(wall);
                // Reset each connected wall's connected endpoints to the proper new start or endpoint of the dragging wall
                connectedWallsMap.iterator.each(function (kvp) {
                    const wKey = kvp.key;
                    const d = kvp.value;
                    const w = fp.findNodeForKey(wKey);
                    if (w != null && w.data.key !== wall.data.key) {
                        fp.model.set(w.data, d.connectedFrom, part.data[d.connectedTo]);
                        wrt.performMiteringOnWall(w);
                    }
                });
                // Miter, which will also update the walls
                wrt.performMiteringAtPoint(wall.data.startpoint, true);
                wrt.performMiteringAtPoint(wall.data.endpoint, true);
                curLoc = wall.location;
                connectedWallsMap.iterator.each(function (kvp) {
                    const w = fp.findNodeForKey(kvp.key);
                    changedWalls.add(w);
                });
                changedWalls.add(wall);
                fp.updateWallDimensions(changedWalls);
                fp.updateWallAngles();
            }
            // check if selected wall is now overlapping some wall it shouldn't be
            const allWalls = fp.findNodesByExample({ category: 'WallGroup' });
            // let cannotMove = false;
            allWalls.iterator.each(function (n) {
                const w = n;
                if (wall && wall.data.key !== w.data.key && fp.getWallsIntersection(wall, w)) {
                    if (!changedWalls.contains(w)) {
                        moveAndUpdate(origLoc);
                        return origLoc;
                    }
                }
            });
            /*
            const changedWalls = new go.Set<go.Group>();
            connectedWallsMap.iterator.each(function(kvp: go.IKeyValuePair<string, any>) {
              const w = fp.findNodeForKey(kvp.key) as go.Group;
              changedWalls.add(w);
            });
            changedWalls.add(wall);
            changedWalls.iterator.each(function(w) {
              wrt.performMiteringOnWall(w);
            });*/
            // return wall.location; // Wall location is updated in updateWall() function based on wall endpoints
            // if (!cannotMove) {
            return wall.location;
            // }
            // return wall.location;
        },
        copyable: false,
    }, $(go.Shape, {
        name: 'SHAPE',
        fill: 'lightgray',
        stroke: 'black',
        strokeWidth: 1,
    }, new go.Binding('fill', 'color'), new go.Binding('stroke', 'isSelected', function (s, obj) {
        if (obj.part.containingGroup != null) {
            const group = obj.part.containingGroup;
            if (s) {
                group.data.isSelected = true;
            }
        }
        return s ? 'dodgerblue' : 'black';
    }).ofObject()));
}
// Room Node
/**
 * Default texture brush
 * @param {string} src The relative path to the texture image
 * @return {go.Brush} A pattern brush
 */
function makeTextureBrush(src) {
    const $ = go.GraphObject.make;
    if (src === null || src === undefined) {
        src = 'images/textures/floor1.jpg';
    }
    const textureImage = new Image();
    textureImage.src = src;
    return $(go.Brush, 'Pattern', { pattern: textureImage });
}
/**
 * Texture selection adornment
 * Clickable buttons to change a Node's texture type
 * @param textures An array of strings that are picture filenames in the /textures directory of the floorplanner project
 *  If this is null, this function will check the Node's 'textures' data property for an analogous Array
 */
function makeTextureSelectionAdornment(textures) {
    const $ = go.GraphObject.make;
    return $(go.Adornment, 'Spot', { locationObjectName: 'BIGPANEL' }, new go.Binding('location', '', function (obj) {
        if (obj.data.category === 'RoomNode') {
            const roomLabel = obj.adornedPart.findObject('ROOM_LABEL');
            const loc = roomLabel.getDocumentPoint(go.Spot.BottomLeft);
            return loc;
        }
        else {
            return obj.adornedPart.getDocumentPoint(go.Spot.BottomLeft);
        }
    }).ofObject(), new go.Binding('visible', '', function (adorn) {
        const node = adorn.adornedPart;
        if (node.category !== 'RoomNode') {
            return node.data.usesTexture;
        }
        return true;
    }).ofObject(), $(go.Placeholder), $(go.Panel, 'Horizontal', { name: 'BIGPANEL' }, 
    // button to show or hide texture choices
    // Room Nodes use a button in their template, so this one is always invisible for room nodes
    $('Button', {
        desiredSize: new go.Size(15, 15),
        click: function (e, obj) {
            const adorn = obj.part;
            const node = adorn.adornedPart;
            if (node !== null) {
                const fp = node.diagram;
                fp.model.setDataProperty(node.data, 'showTextureOptions', !node.data.showTextureOptions);
                node.updateAdornments();
            }
        },
    }, new go.Binding('visible', '', function (adorn) {
        const node = adorn.adornedPart;
        if (node !== null &&
            (node.diagram instanceof go.Palette || node.category === 'RoomNode')) {
            return false;
        }
        return true;
    }).ofObject(), $(go.Shape, 'TriangleLeft', { desiredSize: new go.Size(10, 10), name: 'BUTTONSHAPE' }, new go.Binding('figure', 'showTextureOptions', function (sto) {
        return sto ? 'TriangleLeft' : 'TriangleRight';
    }))), $(go.Panel, 'Horizontal', {
        name: 'PANEL',
        itemArray: textures,
        itemTemplate: $('Button', {
            desiredSize: new go.Size(30, 30),
            click: function (e, button) {
                if (button.part === null || !(button instanceof go.Panel))
                    return;
                const adorn = button.part;
                const node = adorn.adornedPart;
                const imagePicture = button.findObject('BUTTON_IMAGE');
                const imageSource = imagePicture.source;
                if (node.category === 'RoomNode') {
                    e.diagram.model.setDataProperty(node.data, 'floorImage', imageSource);
                }
                else {
                    e.diagram.model.setDataProperty(node.data, 'texture', imageSource);
                }
            },
        }, $(go.Picture, { name: 'BUTTON_IMAGE' }, new go.Binding('source', '', function (str, b) {
            if (typeof str !== 'string')
                return '';
            return './images/textures/' + str;
        }))),
    }, new go.Binding('visible', '', function (a) {
        const node = a.adornedPart;
        if (node.diagram instanceof go.Palette)
            return false;
        if (node.category === 'RoomNode') {
            return node.data.showFlooringOptions;
        }
        else {
            const button = a.findObject('BUTTONSHAPE');
            if (button !== null) {
                return button.figure === 'TriangleLeft';
            }
        }
    }).ofObject(), new go.Binding('itemArray', '', function (data) {
        if (data.textures === undefined || data.textures === null) {
            return textures;
        }
        else {
            return data.textures;
        }
    })) // end horizontal panel PANEL
    ) // end BIGPANEL
    );
}
function makeRoomNode() {
    const $ = go.GraphObject.make;
    return $(go.Node, 'Spot', {
        contextMenu: makeContextMenu(),
        toolTip: makeGroupToolTip(),
        selectionObjectName: 'SHAPE',
        rotateObjectName: 'SHAPE',
        locationSpot: go.Spot.TopLeft,
        reshapable: true,
        copyable: false,
        minSize: new go.Size(1, 1),
        movable: false,
        selectionAdornmentTemplate: makeTextureSelectionAdornment([
            'floor1.jpg',
            'floor2.jpg',
            'floor3.jpg',
            'floor4.jpg',
            'floor5.jpg',
            'floor6.jpg',
            'floor7.jpg',
        ]),
        locationObjectName: 'SHAPE',
        layerName: 'Background',
    }, new go.Binding('location', 'isSelected', function (s, node) {
        const loc = node.data.loc;
        if (s) {
            const sw = node.findObject('SHAPE').strokeWidth;
            const newPt = new go.Point(loc.x - sw * 2, loc.y - sw * 2);
            return newPt;
        }
        else {
            return loc !== undefined ? loc : node.location;
        }
    }).ofObject(), $(go.Shape, // this geometry is dependent on the walls this room is bound by, defined in its data
    {
        name: 'SHAPE',
        fill: makeTextureBrush(null),
        stroke: 'black',
        strokeWidth: 1,
    }, new go.Binding('stroke', 'isSelected', function (s, obj) {
        if (obj.part.containingGroup != null) {
            const group = obj.part.containingGroup;
            if (s) {
                group.data.isSelected = true;
            }
        }
        return s ? 'dodgerblue' : 'black';
    }).ofObject(), new go.Binding('strokeWidth', 'isSelected', function (s, obj) {
        return s ? 5 : 1;
    }).ofObject(), new go.Binding('fill', 'floorImage', function (src) {
        return makeTextureBrush(src);
    })), $(go.Panel, 'Horizontal', {
        cursor: 'move',
        name: 'ROOM_LABEL',
        _isNodeLabel: true,
    }, new go.Binding('alignment', 'labelAlignment'), $(go.Panel, 'Auto', new go.Binding('visible', 'showLabel'), $(go.Shape, 'RoundedRectangle', { fill: 'beige', opacity: 0.5, stroke: null, strokeWidth: 3, name: 'ROOM_LABEL_SHAPE' }, new go.Binding('stroke', 'isSelected', function (is) {
        return is ? 'dodgerblue' : null;
    }).ofObject()), $(go.Panel, 'Vertical', $(go.TextBlock, 'Room Name', { editable: true, cursor: 'text', font: 'normal normal bold 13px sans-serif' }, new go.Binding('text', 'name').makeTwoWay()), $(go.TextBlock, 'Room Size', { name: 'ROOM_LABEL_SIZE' }, new go.Binding('text', '', function (room) {
        const fp = room.diagram;
        const area = fp.getRoomArea(room);
        // convert raw area to units (gotta do it twice, because its units squared)
        const adjustedArea = fp
            .convertPixelsToUnits(fp.convertPixelsToUnits(area))
            .toFixed(2);
        return adjustedArea + fp.model.modelData.unitsAbbreviation + String.fromCharCode(178);
    }).ofObject()))), // end Auto Panel
    $('Button', {
        desiredSize: new go.Size(15, 15),
        click: function (e, button) {
            const r = button.part;
            if (r === null)
                return;
            e.diagram.model.setDataProperty(r.data, 'showFlooringOptions', !r.data.showFlooringOptions);
            const fp = e.diagram;
            fp.select(r); // force Room to reset location
        },
        toolTip: $(go.Adornment, 'Auto', $(go.Shape, { fill: '#FFFFCC' }), $(go.TextBlock, { margin: 4, text: 'Show/ hide floor types' })),
    }, new go.Binding('visible', 'isSelected').ofObject(), $(go.Shape, 'TriangleDown', { desiredSize: new go.Size(10, 10) }, new go.Binding('figure', 'showFlooringOptions', function (showFlooringOptions) {
        return showFlooringOptions ? 'TriangleUp' : 'TriangleDown';
    }))))); // end Node
} // end room node
/*
 * Wall Part Node Dependencies:
 * Get Wall Part Endpoints, Get Wall Part Stretch, Drag Wall Parts (Drag Computation Function),
 * Wall Part Resize Adornment, Door Selection Adornment (Door Nodes only)
 */
/**
 * Find and return an array of the endpoints of a given wallpart (window or door)
 * @param {go.Part} wallPart A Wall Part Node -- i.e. Door Node, Window Node
 * @return {Array<any>}
 */
function getWallPartEndpoints(wallPart) {
    const loc = wallPart.location;
    const partLength = wallPart.data.length;
    let angle = 0;
    if (wallPart.containingGroup !== null) {
        const w = wallPart.containingGroup;
        angle = w.data.startpoint.directionPoint(w.data.endpoint);
    }
    else {
        angle = 180;
    }
    const point1 = new go.Point(loc.x + partLength / 2, loc.y);
    const point2 = new go.Point(loc.x - partLength / 2, loc.y);
    point1.offset(-loc.x, -loc.y).rotate(angle).offset(loc.x, loc.y);
    point2.offset(-loc.x, -loc.y).rotate(angle).offset(loc.x, loc.y);
    const arr = new Array();
    arr.push(point1);
    arr.push(point2);
    return arr;
}
/**
 * Returns a "stretch" (2 Points) that constrains a wallPart (door or window), comprised of "part"'s containing wall endpoints or other wallPart endpoints
 * @param {go.Part} part A Wall Part Node -- i.e. Door Node, Window Node, that is attached to a wall
 * @return {any} An object with fields 'point1' and 'point2'
 */
function getWallPartStretch(part) {
    const wall = part.containingGroup;
    if (wall === null)
        return;
    const startpoint = wall.data.startpoint.copy();
    const endpoint = wall.data.endpoint.copy();
    // sort all possible endpoints into either left/above or right/below
    const leftOrAbove = new go.Set( /*go.Point*/);
    const rightOrBelow = new go.Set( /*go.Point*/);
    wall.memberParts.iterator.each(function (wallPart) {
        if (wallPart.data.key !== part.data.key) {
            const endpoints = getWallPartEndpoints(wallPart);
            for (let i = 0; i < endpoints.length; i++) {
                if (endpoints[i].x < part.location.x ||
                    (endpoints[i].y > part.location.y && endpoints[i].x === part.location.x)) {
                    leftOrAbove.add(endpoints[i]);
                }
                else {
                    rightOrBelow.add(endpoints[i]);
                }
            }
        }
    });
    // do the same with the startpoint and endpoint of the dragging part's wall
    if (parseFloat(startpoint.x.toFixed(2)) < parseFloat(part.location.x.toFixed(2)) ||
        (startpoint.y > part.location.y &&
            parseFloat(startpoint.x.toFixed(2)) === parseFloat(part.location.x.toFixed(2)))) {
        leftOrAbove.add(startpoint);
    }
    else {
        rightOrBelow.add(startpoint);
    }
    if (parseFloat(endpoint.x.toFixed(2)) < parseFloat(part.location.x.toFixed(2)) ||
        (endpoint.y > part.location.y &&
            parseFloat(endpoint.x.toFixed(2)) === parseFloat(part.location.x.toFixed(2)))) {
        leftOrAbove.add(endpoint);
    }
    else {
        rightOrBelow.add(endpoint);
    }
    // of each set, find the closest point to the dragging part
    let leftOrAbovePt;
    let closestDistLeftOrAbove = Number.MAX_VALUE;
    leftOrAbove.iterator.each(function (point) {
        const pt = point;
        const distance = Math.sqrt(pt.distanceSquaredPoint(part.location));
        if (distance < closestDistLeftOrAbove) {
            closestDistLeftOrAbove = distance;
            leftOrAbovePt = pt;
        }
    });
    let rightOrBelowPt;
    let closestDistRightOrBelow = Number.MAX_VALUE;
    rightOrBelow.iterator.each(function (point) {
        const pt = point;
        const distance = Math.sqrt(pt.distanceSquaredPoint(part.location));
        if (distance < closestDistRightOrBelow) {
            closestDistRightOrBelow = distance;
            rightOrBelowPt = pt;
        }
    });
    const stretch = { point1: leftOrAbovePt, point2: rightOrBelowPt };
    return stretch;
}
/**
 * Drag computation function for WindowNodes and DoorNodes; ensure wall parts stay in walls when dragged
 * @param {go.Part} part A reference to dragged Part
 * @param {go.Point} pt The Point describing the proposed location
 * @param {go.Point} gridPt Snapped location
 * @return {go.Point}
 */
const dragWallParts = function (part, pt, gridPt) {
    if (part.containingGroup !== null && part.containingGroup.category === 'WallGroup') {
        const floorplan = part.diagram;
        // Edge Case: if part is not on its wall (due to incorrect load) snap part.loc onto its wall immediately; ideally this is never called
        const wall = part.containingGroup;
        const wStart = wall.data.startpoint;
        const wEnd = wall.data.endpoint;
        const dist1 = Math.sqrt(wStart.distanceSquaredPoint(part.location));
        const dist2 = Math.sqrt(part.location.distanceSquaredPoint(wEnd));
        const totalDist = Math.sqrt(wStart.distanceSquaredPoint(wEnd));
        if (dist1 + dist2 !== totalDist) {
            part.location = part.location.copy().projectOntoLineSegmentPoint(wStart, wEnd);
        }
        // main behavior
        const stretch = getWallPartStretch(part);
        const leftOrAbovePt = stretch.point1;
        const rightOrBelowPt = stretch.point2;
        // calc points along line created by the endpoints that are half the width of the moving window/door
        const totalLength = Math.sqrt(leftOrAbovePt.distanceSquaredPoint(rightOrBelowPt));
        const distance = part.data.length / 2;
        const point1 = new go.Point(leftOrAbovePt.x + (distance / totalLength) * (rightOrBelowPt.x - leftOrAbovePt.x), leftOrAbovePt.y + (distance / totalLength) * (rightOrBelowPt.y - leftOrAbovePt.y));
        const point2 = new go.Point(rightOrBelowPt.x + (distance / totalLength) * (leftOrAbovePt.x - rightOrBelowPt.x), rightOrBelowPt.y + (distance / totalLength) * (leftOrAbovePt.y - rightOrBelowPt.y));
        // calc distance from pt to line (part's wall) - use point to 2pt line segment distance formula
        const distFromWall = Math.abs((wEnd.y - wStart.y) * pt.x -
            (wEnd.x - wStart.x) * pt.y +
            wEnd.x * wStart.y -
            wEnd.y * wStart.x) / Math.sqrt(Math.pow(wEnd.y - wStart.y, 2) + Math.pow(wEnd.x - wStart.x, 2));
        const tolerance = 20 * wall.data.thickness < 100 ? 20 * wall.data.thickness : 100;
        // if distance from pt to line > some tolerance, detach the wallPart from the wall
        if (distFromWall > tolerance) {
            part.containingGroup = null;
            delete part.data.group;
            part.angle = 0;
            floorplan.pointNodes.iterator.each(function (node) {
                floorplan.remove(node);
            });
            floorplan.dimensionLinks.iterator.each(function (link) {
                floorplan.remove(link);
            });
            floorplan.pointNodes.clear();
            floorplan.dimensionLinks.clear();
            floorplan.updateWallDimensions();
        }
        // project the proposed location onto the line segment created by the new points (ensures wall parts are constrained properly when dragged)
        pt = pt.copy().projectOntoLineSegmentPoint(point1, point2);
        floorplan.skipsUndoManager = true;
        floorplan.startTransaction('set loc');
        floorplan.model.setDataProperty(part.data, 'loc', go.Point.stringify(pt));
        floorplan.commitTransaction('set loc');
        floorplan.skipsUndoManager = false;
        floorplan.updateWallDimensions(); // update the dimension links created by having this wall part selected
    }
    return pt;
};
// Resize Adornment for Wall Part Nodes
function makeWallPartResizeAdornment() {
    const $ = go.GraphObject.make;
    return $(go.Adornment, 'Spot', { name: 'WallPartResizeAdornment' }, $(go.Placeholder), $(go.Shape, {
        alignment: go.Spot.Left,
        cursor: 'w-resize',
        figure: 'Diamond',
        desiredSize: new go.Size(7, 7),
        fill: '#ffffff',
        stroke: '#808080',
    }), $(go.Shape, {
        alignment: go.Spot.Right,
        cursor: 'e-resize',
        figure: 'Diamond',
        desiredSize: new go.Size(7, 7),
        fill: '#ffffff',
        stroke: '#808080',
    }));
}
// Selection Adornment for Door Nodes
function makeDoorSelectionAdornment() {
    const $ = go.GraphObject.make;
    return $(go.Adornment, 'Vertical', { name: 'DoorSelectionAdornment' }, $(go.Panel, 'Auto', $(go.Shape, { fill: null, stroke: null }), $(go.Placeholder)), $(go.Panel, 'Horizontal', { defaultStretch: go.Stretch.Vertical }, $('Button', $(go.Picture, { source: 'images/flipDoorOpeningLeft.png', column: 0, desiredSize: new go.Size(12, 12) }, new go.Binding('source', '', function (obj) {
        if (obj.adornedPart === null) {
            return 'images/flipDoorOpeningRight.png';
        }
        else if (obj.adornedPart.data.swing === 'left') {
            return 'images/flipDoorOpeningRight.png';
        }
        else {
            return 'images/flipDoorOpeningLeft.png';
        }
    }).ofObject()), {
        click(e, obj) {
            const part = obj.part;
            if (part !== null && part.diagram !== null) {
                const floorplan = part.diagram;
                floorplan.startTransaction('flip door');
                const adorn = obj.part;
                const door = adorn.adornedPart;
                if (door !== null) {
                    if (door.data.swing === 'left') {
                        floorplan.model.setDataProperty(door.data, 'swing', 'right');
                    }
                    else {
                        floorplan.model.setDataProperty(door.data, 'swing', 'left');
                    }
                    floorplan.commitTransaction('flip door');
                }
            }
        },
        toolTip: $(go.Adornment, 'Auto', $(go.Shape, { fill: '#FFFFCC' }), $(go.TextBlock, { margin: 4, text: 'Flip Door Opening' })),
    }, new go.Binding('visible', '', function (obj) {
        return obj.adornedPart === null ? false : obj.adornedPart.containingGroup !== null;
    }).ofObject()), $('Button', $(go.Picture, {
        source: 'images/flipDoorSide.png',
        column: 0,
        desiredSize: new go.Size(12, 12),
    }), {
        click(e, obj) {
            const part = obj.part;
            if (part !== null && part.diagram !== null) {
                const floorplan = part.diagram;
                floorplan.startTransaction('rotate door');
                const adorn = obj.part;
                const door = adorn.adornedPart;
                door.angle = (door.angle + 180) % 360;
                floorplan.commitTransaction('rotate door');
            }
        },
        toolTip: $(go.Adornment, 'Auto', $(go.Shape, { fill: '#FFFFCC' }), $(go.TextBlock, { margin: 4, text: 'Flip Door Side' })),
    }), new go.Binding('visible', '', function (obj) {
        return obj.adornedPart === null ? false : obj.adornedPart.containingGroup !== null;
    }).ofObject()));
}
/*
 * Wall Part Nodes:
 * Window Node, Door Node, Palette Wall Node
 */
// Window Node
function makeWindowNode() {
    const $ = go.GraphObject.make;
    return $(go.Node, 'Spot', {
        contextMenu: makeContextMenu(),
        selectionObjectName: 'SHAPE',
        selectionAdorned: false,
        locationSpot: go.Spot.Center,
        toolTip: makeNodeToolTip(),
        minSize: new go.Size(5, 5),
        resizable: true,
        resizeAdornmentTemplate: makeWallPartResizeAdornment(),
        resizeObjectName: 'SHAPE',
        rotatable: false,
        dragComputation: dragWallParts,
        layerName: 'Foreground', // make sure windows are always in front of walls
    }, new go.Binding('location', 'loc', go.Point.parse).makeTwoWay(go.Point.stringify), new go.Binding('angle').makeTwoWay(), $(go.Shape, { name: 'SHAPE', fill: 'white', strokeWidth: 0 }, new go.Binding('width', 'length').makeTwoWay(), new go.Binding('height').makeTwoWay(), new go.Binding('stroke', 'isSelected', function (s, obj) {
        return s ? 'dodgerblue' : 'black';
    }).ofObject(), new go.Binding('fill', 'isSelected', function (s, obj) {
        return s ? 'lightgray' : 'white';
    }).ofObject()), $(go.Shape, { name: 'LINESHAPE', fill: 'darkgray', strokeWidth: 0, height: 10 }, new go.Binding('width', 'length', function (width, obj) {
        return width - 10;
    }), // 5px padding each side
    new go.Binding('height', 'height', function (height, obj) {
        return height / 5;
    }), new go.Binding('stroke', 'isSelected', function (s, obj) {
        return s ? 'dodgerblue' : 'black';
    }).ofObject()));
}
// Door Node
function makeDoorNode() {
    const $ = go.GraphObject.make;
    return $(go.Node, 'Spot', {
        contextMenu: makeContextMenu(),
        selectionObjectName: 'SHAPE',
        selectionAdornmentTemplate: makeDoorSelectionAdornment(),
        locationSpot: go.Spot.BottomCenter,
        resizable: true,
        resizeObjectName: 'OPENING_SHAPE',
        toolTip: makeNodeToolTip(),
        minSize: new go.Size(10, 10),
        dragComputation: dragWallParts,
        resizeAdornmentTemplate: makeWallPartResizeAdornment(),
        layerName: 'Foreground', // make sure windows are always in front of walls
    }, 
    // remember location of the Node
    new go.Binding('location', 'loc', go.Point.parse).makeTwoWay(go.Point.stringify), new go.Binding('angle').makeTwoWay(), 
    // the door's locationSpot is affected by it's openingHeight, which is affected by the thickness of its containing wall
    new go.Binding('locationSpot', 'doorOpeningHeight', function (doh, obj) {
        return new go.Spot(0.5, 1, 0, -(doh / 2));
    }), 
    // this is the shape that reprents the door itself and its swing
    $(go.Shape, { name: 'SHAPE', fill: 'rgba(0, 0, 0, 0)' }, new go.Binding('width', 'length'), new go.Binding('height', 'length').makeTwoWay(), new go.Binding('stroke', 'isSelected', function (s, obj) {
        return s ? 'dodgerblue' : 'black';
    }).ofObject(), 
    // new go.Binding("fill", "color"),
    new go.Binding('geometryString', 'swing', function (swing) {
        if (swing === 'left') {
            return 'F1 M0,0 v-150 a150,150 0 0,1 150,150 ';
        }
        else {
            return 'F1 M275,175 v-150 a150,150 0 0,0 -150,150 ';
        }
    })), 
    // door opening shape
    $(go.Shape, {
        name: 'OPENING_SHAPE',
        fill: 'white',
        strokeWidth: 0,
        height: 5,
        width: 40,
        alignment: go.Spot.BottomCenter,
        alignmentFocus: go.Spot.Top,
    }, new go.Binding('height', 'doorOpeningHeight').makeTwoWay(), new go.Binding('stroke', 'isSelected', function (s, obj) {
        return s ? 'dodgerblue' : 'black';
    }).ofObject(), new go.Binding('fill', 'isSelected', function (s, obj) {
        return s ? 'lightgray' : 'white';
    }).ofObject(), new go.Binding('width', 'length').makeTwoWay()));
}
// Palette Wall Node (becomes WallGroup when dropped from Palette onto diagram)
function makePaletteWallNode() {
    const $ = go.GraphObject.make;
    return $(go.Node, 'Spot', { selectionAdorned: false }, $(go.Shape, { name: 'SHAPE', fill: 'black', strokeWidth: 0, height: 10, figure: 'Rectangle' }, new go.Binding('width', 'length').makeTwoWay(), new go.Binding('height').makeTwoWay(), new go.Binding('fill', 'isSelected', function (s, obj) {
        return s ? 'dodgerblue' : 'black';
    }).ofObject(), new go.Binding('stroke', 'isSelected', function (s, obj) {
        return s ? 'dodgerblue' : 'black';
    }).ofObject()));
}
// Node Data Array for Furniture Palette
const FURNITURE_NODE_DATA_ARRAY = [
    {
        category: 'MultiPurposeNode',
        key: 'MultiPurposeNode',
        caption: 'Multi Purpose Node',
        color: '#ffffff',
        stroke: '#000000',
        name: 'Writable Node',
        type: 'Writable Node',
        shape: 'Rectangle',
        text: 'Write here',
        showLabel: true,
        width: 60,
        height: 60,
        notes: '',
        texture: 'granite1.jpg',
        usesTexture: true,
        showTextureOptions: true,
        textures: ['wood1.jpg', 'wood2.jpg', 'granite1.jpg', 'porcelain1.jpg', 'steel1.jpg'],
    },
    {
        key: 'roundTable',
        color: '#ffffff',
        stroke: '#000000',
        caption: 'Round Table',
        type: 'Round Table',
        shape: 'Ellipse',
        width: 61,
        height: 61,
        notes: '',
        texture: 'wood1.jpg',
        usesTexture: true,
        showTextureOptions: true,
        textures: ['wood1.jpg', 'wood2.jpg', 'floor3.jpg', 'granite1.jpg', 'porcelain1.jpg'],
    },
    {
        key: 'armChair',
        color: 'purple',
        stroke: '#000000',
        caption: 'Arm Chair',
        type: 'Arm Chair',
        geo: 'F1 M0 0 L40 0 40 40 0 40 0 0 M10 30 L10 10 M0 0 Q8 0 10 10 M0 40 Q20 15 40 40 M30 10 Q32 0 40 0 M30 10 L30 30',
        width: 45,
        height: 45,
        notes: '',
        texture: 'fabric1.jpg',
        usesTexture: true,
        showTextureOptions: true,
        textures: ['fabric1.jpg', 'fabric2.jpg', 'fabric3.jpg'],
    },
    {
        key: 'sofaMedium',
        color: '#ffffff',
        stroke: '#000000',
        caption: 'Sofa',
        type: 'Sofa',
        geo: 'F1 M0 0 L80 0 80 40 0 40 0 0 M10 35 L10 10 M0 0 Q8 0 10 10 M0 40 Q40 15 80 40 M70 10 Q72 0 80 0 M70 10 L70 35',
        height: 45,
        width: 90,
        notes: '',
        texture: 'fabric2.jpg',
        usesTexture: true,
        showTextureOptions: true,
        textures: ['fabric1.jpg', 'fabric2.jpg', 'fabric3.jpg'],
    },
    {
        key: 'sink',
        color: '#ffffff',
        stroke: '#000000',
        caption: 'Sink',
        type: 'Sink',
        geo: 'F1 M0 0 L40 0 40 40 0 40 0 0z M5 7.5 L18.5 7.5 M 21.5 7.5 L35 7.5 35 35 5 35 5 7.5 M 15 21.25 A 5 5 180 1 0 15 21.24' +
            'M23 3.75 A 3 3 180 1 1 23 3.74 M21.5 6.25 L 21.5 12.5 18.5 12.5 18.5 6.25 M15 3.75 A 1 1 180 1 1 15 3.74' +
            'M 10 4.25 L 10 3.25 13 3.25 M 13 4.25 L 10 4.25 M27 3.75 A 1 1 180 1 1 27 3.74 M 26.85 3.25 L 30 3.25 30 4.25 M 26.85 4.25 L 30 4.25',
        width: 27,
        height: 27,
        notes: '',
        texture: 'steel1.jpg',
        usesTexture: true,
        showTextureOptions: true,
        textures: ['copper1.jpg', 'steel1.jpg', 'steel2.jpg', 'porcelain1.jpg'],
    },
    {
        key: 'doubleSink',
        color: '#ffffff',
        stroke: '#000000',
        caption: 'Double Sink',
        type: 'Double Sink',
        geo: 'F1 M0 0 L75 0 75 40 0 40 0 0 M5 7.5 L35 7.5 35 35 5 35 5 7.5 M44 7.5 L70 7.5 70 35 40 35 40 9' +
            'M15 21.25 A5 5 180 1 0 15 21.24 M50 21.25 A 5 5 180 1 0 50 21.24 M40.5 3.75 A3 3 180 1 1 40.5 3.74' +
            'M40.5 3.75 L50.5 13.75 47.5 16.5 37.5 6.75 M32.5 3.75 A 1 1 180 1 1 32.5 3.74 M 27.5 4.25 L 27.5 3.25 30.5 3.25' +
            'M 30.5 4.25 L 27.5 4.25 M44.5 3.75 A 1 1 180 1 1 44.5 3.74 M 44.35 3.25 L 47.5 3.25 47.5 4.25 M 44.35 4.25 L 47.5 4.25',
        height: 27,
        width: 52,
        notes: '',
        texture: 'steel2.jpg',
        usesTexture: true,
        showTextureOptions: true,
        textures: ['copper1.jpg', 'steel1.jpg', 'steel2.jpg', 'porcelain1.jpg'],
    },
    {
        key: 'toilet',
        color: '#ffffff',
        stroke: '#000000',
        caption: 'Toilet',
        type: 'Toilet',
        geo: 'F1 M0 0 L25 0 25 10 0 10 0 0 M20 10 L20 15 5 15 5 10 20 10 M5 15 Q0 15 0 25 Q0 40 12.5 40 Q25 40 25 25 Q25 15 20 15',
        width: 25,
        height: 35,
        notes: '',
        texture: 'porcelain1.jpg',
        usesTexture: true,
        showTextureOptions: true,
        textures: ['copper1.jpg', 'steel1.jpg', 'porcelain1.jpg'],
    },
    {
        key: 'shower',
        color: '#ffffff',
        stroke: '#000000',
        caption: 'Shower/Tub',
        type: 'Shower/Tub',
        geo: 'F1 M0 0 L40 0 40 60 0 60 0 0 M35 15 L35 55 5 55 5 15 Q5 5 20 5 Q35 5 35 15 M22.5 20 A2.5 2.5 180 1 1 22.5 19.99',
        width: 45,
        height: 75,
        notes: '',
        texture: 'copper1.jpg',
        usesTexture: true,
        showTextureOptions: true,
        textures: ['copper1.jpg', 'steel1.jpg', 'porcelain1.jpg'],
    },
    {
        key: 'bed',
        color: '#ffffff',
        stroke: '#000000',
        caption: 'Bed',
        type: 'Bed',
        geo: 'F1 M0 0 L40 0 40 60 0 60 0 0 M 7.5 2.5 L32.5 2.5 32.5 17.5 7.5 17.5 7.5 2.5 M0 20 L40 20 M0 25 L40 25',
        width: 76.2,
        height: 101.6,
        notes: '',
        texture: 'fabric3.jpg',
        usesTexture: true,
        showTextureOptions: true,
        textures: ['fabric1.jpg', 'fabric2.jpg', 'fabric3.jpg'],
    },
    {
        key: 'staircase',
        color: '#ffffff',
        stroke: '#000000',
        caption: 'Staircase',
        type: 'Staircase',
        geo: 'F1 M0 0 L 0 100 250 100 250 0 0 0 M25 100 L 25 0 M 50 100 L 50 0 M 75 100 L 75 0' +
            'M 100 100 L 100 0 M 125 100 L 125 0 M 150 100 L 150 0 M 175 100 L 175 0 M 200 100 L 200 0 M 225 100 L 225 0',
        width: 125,
        height: 50,
        notes: '',
        texture: '',
        usesTexture: true,
        showTextureOptions: true,
        textures: ['wood1.jpg', 'floor1.jpg', 'wood2.jpg', 'steel2.jpg', 'floor2.jpg'],
    },
    {
        key: 'stove',
        color: '#ffffff',
        stroke: '#000000',
        caption: 'Stove',
        type: 'Stove',
        geo: 'F1 M 0 0 L 0 100 100 100 100 0 0 0' +
            // top left burner
            'M 30 15 A 15 15 180 1 0 30.01 15' +
            'M 30 20 A 10 10 180 1 0 30.01 20' +
            'M 30 25 A 5 5 180 1 0 30.01 25' +
            // top right burner
            'M 70 15 A 15 15 180 1 0 70.01 15' +
            'M 70 20 A 10 10 180 1 0 70.01 20' +
            'M 70 25 A 5 5 180 1 0 70.01 25' +
            // bottom left burner
            'M 30 55 A 15 15 180 1 0 30.01 55' +
            'M 30 60 A 10 10 180 1 0 30.01 60' +
            'M 30 65 A 5 5 180 1 0 30.01 65' +
            // bottom right burner
            'M 70 55 A 15 15 180 1 0 70.01 55' +
            'M 70 60 A 10 10 180 1 0 70.01 60' +
            'M 70 65 A 5 5 180 1 0 70.01 65',
        width: 75,
        height: 75,
        notes: '',
        texture: 'plaster1.jpg',
        usesTexture: true,
        showTextureOptions: true,
        textures: ['steel1.jpg', 'porcelain1.jpg', 'copper1.jpg', 'plaster1.jpg'],
    },
    {
        key: 'diningTable',
        color: '#ffffff',
        stroke: '#000000',
        caption: 'Dining Table',
        type: 'Dining Table',
        geo: 'F1 M 0 0 L 0 100 200 100 200 0 0 0 M 25 0 L 25 -10 75 -10 75 0 M 125 0 L 125 -10 175 -10 175 0' +
            ' M 200 25 L 210 25 210 75 200 75 M 125 100 L 125 110 L 175 110 L 175 100 M 25 100 L 25 110 75 110 75 100 M 0 75 -10 75 -10 25 0 25',
        width: 125,
        height: 62.5,
        notes: '',
        texture: 'wood2.jpg',
        usesTexture: true,
        showTextureOptions: true,
        textures: [
            'wood1.jpg',
            'wood2.jpg',
            'floor3.jpg',
            'granite1.jpg',
            'porcelain1.jpg',
            'steel2.jpg',
        ],
    },
];
// Node Data Array for Wall Parts Palette
const WALLPARTS_NODE_DATA_ARRAY = [
    {
        category: 'WindowNode',
        key: 'window',
        color: 'white',
        caption: 'Window',
        type: 'Window',
        shape: 'Rectangle',
        height: 10,
        length: 60,
        notes: '',
    },
    {
        key: 'door',
        category: 'DoorNode',
        caption: 'Door',
        type: 'Door',
        length: 40,
        doorOpeningHeight: 5,
        swing: 'left',
        notes: '',
    },
    {
        key: 'floor',
        category: 'FloorNode',
        src: 'images/textures/floor1.jpg',
    },
];
// export = Floorplan;
