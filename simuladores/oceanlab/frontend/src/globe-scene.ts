import {
  ArcRotateCamera, Color3, Color4, DynamicTexture, Engine, GlowLayer, HemisphericLight, Mesh,
  MeshBuilder, PointerEventTypes, Scene, StandardMaterial, Vector3,
} from "@babylonjs/core";
import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import atlas from "world-atlas/countries-110m.json";
import type { Buoy } from "./types";


export class GlobeScene {
  private engine: Engine;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private markers = new Map<string, Mesh>();
  private selectedId = "";
  private onSelect: (id: string) => void;

  constructor(canvas: HTMLCanvasElement, onSelect: (id: string) => void) {
    this.onSelect = onSelect;
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0);
    this.camera = new ArcRotateCamera("orbit", -1.5, 1.25, 8.1, Vector3.Zero(), this.scene);
    this.camera.lowerRadiusLimit = 5.1;
    this.camera.upperRadiusLimit = 10.5;
    this.camera.wheelPrecision = 55;
    this.camera.panningSensibility = 0;
    this.camera.attachControl(canvas, true);
    new HemisphericLight("sun", new Vector3(-1, 0.8, -0.4), this.scene).intensity = 1.25;
    this.createEarth();
    this.createAtmosphere();
    this.scene.onPointerObservable.add((info) => {
      if (info.type !== PointerEventTypes.POINTERPICK) return;
      const id = info.pickInfo?.pickedMesh?.metadata?.buoyId as string | undefined;
      if (id) this.onSelect(id);
    });
    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener("resize", () => this.engine.resize());
  }

  private createEarth(): void {
    const earth = MeshBuilder.CreateSphere("earth", { diameter: 6, segments: 96 }, this.scene);
    const texture = new DynamicTexture("earth-map", { width: 2048, height: 1024 }, this.scene, false);
    const context = texture.getContext();
    const gradient = context.createLinearGradient(0, 0, 0, 1024);
    gradient.addColorStop(0, "#123d50"); gradient.addColorStop(0.45, "#07506a"); gradient.addColorStop(1, "#0b354b");
    context.fillStyle = gradient; context.fillRect(0, 0, 2048, 1024);
    context.strokeStyle = "rgba(108,201,213,.12)"; context.lineWidth = 1;
    for (let lon = -180; lon <= 180; lon += 15) { const x = (lon + 180) / 360 * 2048; context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 1024); context.stroke(); }
    for (let lat = -75; lat <= 75; lat += 15) { const y = (90 - lat) / 180 * 1024; context.beginPath(); context.moveTo(0, y); context.lineTo(2048, y); context.stroke(); }
    const world = feature(atlas as never, (atlas as unknown as { objects: { countries: never } }).objects.countries);
    context.fillStyle = "#467c68"; context.strokeStyle = "rgba(183,225,190,.6)"; context.lineWidth = 1.2;
    const projection = geoEquirectangular()
      .translate([1024, 512])
      .scale(2048 / (2 * Math.PI))
      .precision(0.15);
    const mapPath = geoPath(projection, context as unknown as CanvasRenderingContext2D);
    context.beginPath();
    mapPath(world);
    context.fill();
    context.stroke();
    texture.update();
    const material = new StandardMaterial("earth-material", this.scene);
    // Babylon interpreta ambos ejes UV de la esfera en sentido opuesto al lienzo
    // equirectangular. Invertir U y V evita que el mapa quede especular y mantiene
    // norte/sur y este/oeste en su orientación cartográfica convencional.
    texture.uScale = -1;
    texture.uOffset = 1;
    texture.vScale = -1;
    texture.vOffset = 1;
    material.diffuseTexture = texture; material.specularColor = new Color3(0.25, 0.55, 0.65); material.specularPower = 44;
    earth.material = material;
  }

  private createAtmosphere(): void {
    const atmosphere = MeshBuilder.CreateSphere("atmosphere", { diameter: 6.14, segments: 64 }, this.scene);
    const material = new StandardMaterial("atmosphere-material", this.scene);
    material.emissiveColor = new Color3(0.1, 0.55, 0.7); material.alpha = 0.075; material.backFaceCulling = false;
    atmosphere.material = material; atmosphere.isPickable = false;
    const glow = new GlowLayer("buoy-glow", this.scene, { blurKernelSize: 32 }); glow.intensity = 0.8;
  }

  private position(latitude: number, longitude: number, radius = 3.07): Vector3 {
    const lat = latitude * Math.PI / 180;
    const lon = longitude * Math.PI / 180;
    // CreateSphere parte del eje -X para U=0,5 y recorre U alrededor de Y.
    // Esta conversión reproduce exactamente esa parametrización UV para que
    // longitud geográfica y textura coincidan, incluido el antimeridiano.
    return new Vector3(
      -radius * Math.cos(lat) * Math.cos(lon),
      radius * Math.sin(lat),
      -radius * Math.cos(lat) * Math.sin(lon),
    );
  }

  update(buoys: Buoy[]): void {
    for (const buoy of buoys) {
      let marker = this.markers.get(buoy.id);
      if (!marker) {
        marker = MeshBuilder.CreateSphere(`marker-${buoy.id}`, { diameter: 0.105, segments: 10 }, this.scene);
        marker.position = this.position(buoy.latitude, buoy.longitude);
        marker.metadata = { buoyId: buoy.id };
        const material = new StandardMaterial(`material-${buoy.id}`, this.scene);
        material.disableLighting = true; marker.material = material;
        this.markers.set(buoy.id, marker);
      }
      const material = marker.material as StandardMaterial;
      const warning = buoy.battery_pct < 20 || buoy.wave_height_m > 6;
      const color = buoy.status === "offline" ? new Color3(0.4, 0.47, 0.5) : warning ? new Color3(1, 0.65, 0.25) : new Color3(0.35, 1, 0.76);
      material.emissiveColor = color; material.diffuseColor = color;
      const selected = buoy.id === this.selectedId;
      marker.scaling.setAll(selected ? 2.15 : warning ? 1.35 : 1);
    }
  }

  select(buoy: Buoy, focus = false): void {
    this.selectedId = buoy.id;
    if (focus) {
      const p = this.position(buoy.latitude, buoy.longitude);
      const radius = Math.sqrt(p.x * p.x + p.z * p.z);
      this.camera.alpha = Math.atan2(p.z, p.x) - Math.PI / 2;
      this.camera.beta = Math.atan2(radius, p.y);
      this.camera.radius = 6.5;
    }
  }
}
