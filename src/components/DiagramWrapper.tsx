/*
 *  Copyright (C) 1998-2023 by Northwoods Software Corporation. All Rights Reserved.
 */

import * as go from "gojs";
import { ReactDiagram } from "gojs-react";
import * as React from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

import { GuidedDraggingTool } from "../GuidedDraggingTool";

import "./Diagram.css";

const ydoc = new Y.Doc();
const clienId = ydoc.clientID;
console.log("clientId", clienId);

interface DiagramProps {
  nodeDataArray: Array<go.ObjectData>;
  linkDataArray: Array<go.ObjectData>;
  modelData: go.ObjectData;
  skipsDiagramUpdate: boolean;
  onDiagramEvent: (e: go.DiagramEvent) => void;
  onModelChange: (e: go.IncrementalData) => void;
}

export class DiagramWrapper extends React.Component<DiagramProps, {}> {
  /**
   * Ref to keep a reference to the Diagram component, which provides access to the GoJS diagram via getDiagram().
   */
  private diagramRef: React.RefObject<ReactDiagram>;

  private diagramStyle = { backgroundColor: "#eee" };

  private yModel: any;

  /** @internal */
  constructor(props: DiagramProps) {
    super(props);
    this.diagramRef = React.createRef();
    this.startY();
  }

  /**
   * Get the diagram reference and add any desired diagram listeners.
   * Typically the same function will be used for each listener, with the function using a switch statement to handle the events.
   */
  public componentDidMount() {
    if (!this.diagramRef.current) return;
    const diagram = this.diagramRef.current.getDiagram();
    if (diagram instanceof go.Diagram) {
      diagram.addDiagramListener("ChangedSelection", this.props.onDiagramEvent);
    }
  }

  /**
   * Get the diagram reference and remove listeners that were added during mounting.
   */
  public componentWillUnmount() {
    if (!this.diagramRef.current) return;
    const diagram = this.diagramRef.current.getDiagram();
    if (diagram instanceof go.Diagram) {
      diagram.removeDiagramListener(
        "ChangedSelection",
        this.props.onDiagramEvent
      );
    }
  }

  private syncPosition = (key: number, position: any) => {
    if (!this.diagramRef.current) return;
    const diagram = this.diagramRef.current.getDiagram();
    if (diagram instanceof go.Diagram) {
      diagram.model.commit((m) => {
        var data = m.nodeDataArray[key];
        console.log("position: ", data.loc);
        var newLoc = `${position.x} ${position.y}`;
        if (data && data.loc !== newLoc) {
          m.set(data, "loc", `${position.x} ${position.y}`);
        }
      }, "sync position");
    }
  };

  private startY() {
    const wsProvider = new WebsocketProvider(
      "ws://localhost:1234",
      "my-roomname",
      ydoc
    );

    wsProvider.on("status", (event: any) => {
      console.log(event.status); // logs "connected" or "disconnected"
    });

    this.yModel = ydoc.getMap("model");

    /* 
    yNodesMap.observe listens for changes in the yMap, receiving a set of the keys that have
    had changed values.  If the change was to delete an entry, the corresponding node and all links to/from it are
    removed from the local nodes dataSet. Otherwise, if the received node differs from the local one, 
    the local node dataSet is updated (which includes adding a new node if it does not already exist locally).
     */
    this.yModel.observe((evt: any) => {
      // let nodesToUpdate = [];
      // let nodesToRemove = [];
      for (let key of evt.keysChanged) {
        console.log("key change: ", key);
        console.log("delta:", evt.changes.delta);
        if (this.yModel.has(key)) {
          let obj = this.yModel.get(key);
          console.log("true!:", obj);
          this.syncPosition(+key, obj);
        }
      }
    });
  }

  /**
   * Diagram initialization method, which is passed to the ReactDiagram component.
   * This method is responsible for making the diagram and initializing the model, any templates,
   * and maybe doing other initialization tasks like customizing tools.
   * The model's data should not be set here, as the ReactDiagram component handles that.
   */
  private initDiagram(): go.Diagram {
    const $ = go.GraphObject.make;
    // set your license key here before creating the diagram: go.Diagram.licenseKey = "...";
    const diagram = $(go.Diagram, {
      "undoManager.isEnabled": true, // must be set to allow for model change listening
      // 'undoManager.maxHistoryLength': 0,  // uncomment disable undo/redo functionality
      "clickCreatingTool.archetypeNodeData": {
        text: "new node",
        color: "lightblue",
      },
      draggingTool: new GuidedDraggingTool(), // defined in GuidedDraggingTool.ts
      "draggingTool.horizontalGuidelineColor": "blue",
      "draggingTool.verticalGuidelineColor": "blue",
      "draggingTool.centerGuidelineColor": "green",
      "draggingTool.guidelineWidth": 1,
      layout: $(go.ForceDirectedLayout),
      model: $(go.GraphLinksModel, {
        linkKeyProperty: "key", // IMPORTANT! must be defined for merges and data sync when using GraphLinksModel
        // positive keys for nodes
        makeUniqueKeyFunction: (m: go.Model, data: any) => {
          let k = data.key || 1;
          while (m.findNodeDataForKey(k)) k++;
          data.key = k;
          return k;
        },
        // negative keys for links
        makeUniqueLinkKeyFunction: (m: go.GraphLinksModel, data: any) => {
          let k = data.key || -1;
          while (m.findLinkDataForKey(k)) k--;
          data.key = k;
          return k;
        },
      }),
    });

    diagram.model.addChangedListener((evt: any) => {
      if (!evt.isTransactionFinished) return;
      var txn = evt.object; // a Transaction
      if (txn === null) return;
      var nodes = new go.Map();
      txn.changes.each(function (c: any) {
        if (
          c.change === go.ChangedEvent.Property &&
          c.propertyName === "position"
        ) {
          nodes.add(c.object.key, c.object.position);
        }
      });

      const cloneThis = this;

      nodes.each(function (kvp: any) {
        console.log("moved " + kvp.key + " to " + kvp.value.toString());
        ydoc.transact(() => {
          cloneThis.yModel?.set(kvp.key.toString(), {
            x: kvp.value.x,
            y: kvp.value.y,
          });
        });
      });
    });

    // define a simple Node template
    diagram.nodeTemplate = $(
      go.Node,
      "Auto", // the Shape will go around the TextBlock
      new go.Binding("location", "loc", go.Point.parse),
      $(
        go.Shape,
        "RoundedRectangle",
        {
          name: "SHAPE",
          fill: "white",
          strokeWidth: 0,
          // set the port properties:
          portId: "",
          fromLinkable: true,
          toLinkable: true,
          cursor: "pointer",
        },
        // Shape.fill is bound to Node.data.color
        new go.Binding("fill", "color")
      ),
      $(
        go.TextBlock,
        { margin: 8, editable: true, font: "400 .875rem Roboto, sans-serif" }, // some room around the text
        new go.Binding("text").makeTwoWay()
      )
    );

    // relinking depends on modelData
    diagram.linkTemplate = $(
      go.Link,
      new go.Binding("relinkableFrom", "canRelink").ofModel(),
      new go.Binding("relinkableTo", "canRelink").ofModel(),
      $(go.Shape),
      $(go.Shape, { toArrow: "Standard" })
    );

    return diagram;
  }

  public render() {
    return (
      <ReactDiagram
        ref={this.diagramRef}
        divClassName="diagram-component"
        style={this.diagramStyle}
        initDiagram={this.initDiagram.bind(this)}
        nodeDataArray={this.props.nodeDataArray}
        linkDataArray={this.props.linkDataArray}
        modelData={this.props.modelData}
        onModelChange={this.props.onModelChange}
        skipsDiagramUpdate={this.props.skipsDiagramUpdate}
      />
    );
  }
}
