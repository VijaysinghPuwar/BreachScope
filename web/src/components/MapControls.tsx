import { useSample } from '../lib/api';
import { Layers as LayersIcon, Minus, Orbit, Plus, RotateCcw } from 'lucide-react';
import { dataClasses, classNames, type DataClass } from '../data/events';
import { layerDefinitions, type Layers, type MapActions, type Projection } from '../map/types';
import { Button, Chip, PopoverPanel, SegmentedControl } from './ui';
export function ClassFilters({
  classes,
  onToggle,
}: {
  classes: DataClass[];
  onToggle(code: DataClass): void;
}) {
  return (
    <div className="class-checkboxes">
      {dataClasses.map((code) => (
        <label key={code}>
          <input type="checkbox" checked={classes.includes(code)} onChange={() => onToggle(code)} />
          <Chip code={code} />
          <span>{classNames[code]}</span>
        </label>
      ))}
    </div>
  );
}
export function MapControls({
  projection,
  onProjection,
  layers,
  onLayers,
  actions,
  mobile,
  classes,
  onToggleClass,
  onSpace,
}: {
  projection: Projection;
  onProjection(value: Projection): void;
  layers: Layers;
  onLayers(value: Layers): void;
  actions: MapActions | null;
  mobile: boolean;
  classes: DataClass[];
  onToggleClass(code: DataClass): void;
  onSpace(): void;
}) {
  return (
    <div className="map-controls" aria-label="Map controls">
      <div className="map-controls-top">
        <SegmentedControl
          label="Projection"
          options={['Flat', 'Globe']}
          value={projection}
          onChange={onProjection}
        />
        <PopoverPanel
          className={mobile ? 'layers-mobile' : ''}
          label="Map layers"
          trigger={
            <Button aria-label="Layers" data-tour={mobile ? 'filters' : undefined}>
              <LayersIcon />
              <span className="layers-label">Layers</span>
            </Button>
          }
        >
          <h2 className="label">Layers</h2>
          {mobile && (
            <>
              <h3 className="label text-secondary">Data classes</h3>
              <ClassFilters classes={classes} onToggle={onToggleClass} />
              <h3 className="label text-secondary">Map layers</h3>
            </>
          )}
          <div className="layer-list">
            {layerDefinitions
              .filter(
                ([key]) => key !== 'density' && (useSample || !['arcs', 'sensors'].includes(key)),
              )
              .map(([key, name, hint]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={layers[key]}
                    disabled={key === 'graticule' && projection === 'Flat'}
                    onChange={() => onLayers({ ...layers, [key]: !layers[key] })}
                  />
                  <span>
                    <span>{name}</span>
                    <small>{hint}</small>
                  </span>
                </label>
              ))}
          </div>
          <a className="popover-footer" href="/about">
            What do these mean?
          </a>
        </PopoverPanel>
      </div>
      <div className="map-zoom">
        <Button iconOnly aria-label="Zoom in" disabled={!actions} onClick={() => actions?.zoom(1)}>
          <Plus />
        </Button>
        <Button
          iconOnly
          aria-label="Zoom out"
          disabled={!actions}
          onClick={() => actions?.zoom(-1)}
        >
          <Minus />
        </Button>
        <Button
          iconOnly
          aria-label="Reset view"
          disabled={!actions}
          onClick={() => actions?.reset()}
        >
          <RotateCcw />
        </Button>
        <Button iconOnly aria-label="Zoom out to space" title="Zoom out to space" onClick={onSpace}>
          <Orbit />
        </Button>
      </div>
    </div>
  );
}
