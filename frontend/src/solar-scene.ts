import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { PlantState, ZoneState } from "./types";


export class SolarScene {
  private engine: Engine;
  private scene: Scene;
  private trackers: TransformNode[] = [];
  private zoneMaterials: PBRMaterial[] = [];
  private clouds: TransformNode[] = [];
  private cloudCover = 18;
  private selectedZone = 0;

  constructor(canvas: HTMLCanvasElement, onZoneSelected: (zone: number) => void) {
    this.engine = new Engine(canvas, true, { antialias: true, preserveDrawingBuffer: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.68, 0.83, 0.91, 1);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.005;
    this.scene.fogColor = new Color3(0.68, 0.82, 0.87);

    const camera = new ArcRotateCamera("camera", -Math.PI / 2.35, 1.08, 72, new Vector3(0, 0, 1), this.scene);
    camera.lowerRadiusLimit = 24;
    camera.upperRadiusLimit = 105;
    camera.lowerBetaLimit = 0.46;
    camera.upperBetaLimit = 1.42;
    camera.wheelPrecision = 24;
    camera.panningSensibility = 0;
    camera.attachControl(canvas, true);

    const skyLight = new HemisphericLight("sky", new Vector3(0.1, 1, 0.2), this.scene);
    skyLight.intensity = 1.25;
    skyLight.groundColor = new Color3(0.15, 0.18, 0.09);
    const sunLight = new DirectionalLight("sun", new Vector3(-0.45, -1, 0.4), this.scene);
    sunLight.intensity = 2.2;

    this.buildTerrain();
    this.buildSolarField();
    this.buildSubstation();
    this.buildClouds();

    this.scene.onPointerDown = (_, pick) => {
      const zone = pick?.pickedMesh?.metadata?.zone as number | undefined;
      if (zone !== undefined) {
        this.selectedZone = zone;
        this.refreshMaterialSelection();
        onZoneSelected(zone);
      }
    };
    this.scene.onBeforeRenderObservable.add(() => {
      const dt = this.engine.getDeltaTime() / 1000;
      this.clouds.forEach((cloud, index) => {
        cloud.position.x += dt * (0.55 + index * 0.08);
        if (cloud.position.x > 42) cloud.position.x = -42;
        cloud.setEnabled(index < Math.ceil(this.cloudCover / 23));
      });
    });
    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener("resize", () => this.engine.resize());
  }

  private buildTerrain(): void {
    const ground = MeshBuilder.CreateGround("terrain", { width: 120, height: 95, subdivisions: 2 }, this.scene);
    const groundMaterial = new PBRMaterial("dry-grass", this.scene);
    groundMaterial.albedoColor = new Color3(0.35, 0.45, 0.17);
    groundMaterial.roughness = 1;
    ground.material = groundMaterial;
    const road = MeshBuilder.CreateGround("service-road", { width: 7, height: 96 }, this.scene);
    road.position.x = 27;
    road.position.y = 0.025;
    const roadMaterial = new StandardMaterial("road", this.scene);
    roadMaterial.diffuseColor = new Color3(0.49, 0.43, 0.28);
    roadMaterial.specularColor = Color3.Black();
    road.material = roadMaterial;
    for (let i = 0; i < 22; i += 1) {
      const shrub = MeshBuilder.CreateSphere(`shrub-${i}`, { diameter: 0.8 + (i % 3) * 0.3, segments: 5 }, this.scene);
      shrub.scaling.y = 0.55;
      shrub.position = new Vector3(-48 + (i * 17) % 96, 0.4, -40 + (i * 23) % 84);
      const material = new StandardMaterial(`shrub-mat-${i}`, this.scene);
      material.diffuseColor = new Color3(0.16 + (i % 3) * 0.025, 0.27, 0.07);
      material.specularColor = Color3.Black();
      shrub.material = material;
    }
  }

  private buildSolarField(): void {
    for (let zone = 0; zone < 4; zone += 1) {
      const panelMaterial = new PBRMaterial(`panels-zone-${zone}`, this.scene);
      panelMaterial.albedoColor = new Color3(0.025, 0.11, 0.20);
      panelMaterial.metallic = 0.6;
      panelMaterial.roughness = 0.23;
      this.zoneMaterials.push(panelMaterial);
    }
    const postMaterial = new StandardMaterial("posts", this.scene);
    postMaterial.diffuseColor = new Color3(0.24, 0.27, 0.25);
    postMaterial.specularColor = new Color3(0.1, 0.1, 0.1);

    for (let row = 0; row < 8; row += 1) {
      const zone = Math.floor(row / 2);
      for (let column = 0; column < 12; column += 1) {
        const x = -34 + column * 5.2;
        const z = -28 + row * 8.1;
        const tracker = new TransformNode(`tracker-${row}-${column}`, this.scene);
        tracker.position = new Vector3(x, 2.15, z);
        tracker.rotation.x = -0.22;
        const panel = MeshBuilder.CreateBox(`panel-${row}-${column}`, { width: 4.35, height: 0.11, depth: 3.05 }, this.scene);
        panel.parent = tracker;
        panel.material = this.zoneMaterials[zone];
        panel.metadata = { zone };
        const lineMaterial = new StandardMaterial(`grid-${row}-${column}`, this.scene);
        lineMaterial.diffuseColor = new Color3(0.48, 0.63, 0.67);
        lineMaterial.emissiveColor = new Color3(0.03, 0.06, 0.07);
        for (let line = -1; line <= 1; line += 1) {
          const rail = MeshBuilder.CreateBox(`rail-${row}-${column}-${line}`, { width: 0.025, height: 0.018, depth: 3.04 }, this.scene);
          rail.position.x = line * 1.42;
          rail.position.y = 0.066;
          rail.parent = tracker;
          rail.material = lineMaterial;
          rail.metadata = { zone };
        }
        const post = MeshBuilder.CreateBox(`post-${row}-${column}`, { width: 0.16, height: 2.1, depth: 0.16 }, this.scene);
        post.position = new Vector3(x, 1.05, z);
        post.material = postMaterial;
        post.metadata = { zone };
        this.trackers.push(tracker);
      }
    }
  }

  private buildSubstation(): void {
    const baseMaterial = new PBRMaterial("substation-white", this.scene);
    baseMaterial.albedoColor = new Color3(0.76, 0.79, 0.72);
    baseMaterial.roughness = 0.8;
    const block = MeshBuilder.CreateBox("control-building", { width: 8.5, height: 3.8, depth: 5.5 }, this.scene);
    block.position = new Vector3(34, 1.9, 19);
    block.material = baseMaterial;
    const roof = MeshBuilder.CreateBox("control-roof", { width: 9.1, height: 0.25, depth: 6.1 }, this.scene);
    roof.position = new Vector3(34, 3.9, 19);
    roof.material = baseMaterial;
    const transformerMaterial = new StandardMaterial("transformer-mat", this.scene);
    transformerMaterial.diffuseColor = new Color3(0.12, 0.29, 0.25);
    for (let i = 0; i < 3; i += 1) {
      const transformer = MeshBuilder.CreateBox(`transformer-${i}`, { width: 2.1, height: 2.4, depth: 1.6 }, this.scene);
      transformer.position = new Vector3(31 + i * 3.1, 1.2, 12.5);
      transformer.material = transformerMaterial;
    }
    const towerMaterial = new StandardMaterial("tower", this.scene);
    towerMaterial.diffuseColor = new Color3(0.36, 0.38, 0.36);
    for (let side of [-1, 1]) {
      const pylon = MeshBuilder.CreateCylinder(`pylon-${side}`, { height: 15, diameterTop: 0.25, diameterBottom: 1.1, tessellation: 4 }, this.scene);
      pylon.position = new Vector3(43, 7.5, 4 + side * 10);
      pylon.material = towerMaterial;
    }
  }

  private buildClouds(): void {
    const cloudMaterial = new StandardMaterial("cloud-mat", this.scene);
    cloudMaterial.diffuseColor = new Color3(0.92, 0.94, 0.92);
    cloudMaterial.alpha = 0.72;
    cloudMaterial.specularColor = Color3.Black();
    for (let i = 0; i < 5; i += 1) {
      const cloud = new TransformNode(`cloud-${i}`, this.scene);
      cloud.position = new Vector3(-35 + i * 15, 17 + (i % 2) * 3, -12 + i * 7);
      for (let part = 0; part < 4; part += 1) {
        const puff = MeshBuilder.CreateSphere(`cloud-${i}-${part}`, { diameter: 5 + (part % 2), segments: 8 }, this.scene);
        puff.scaling.y = 0.42;
        puff.position = new Vector3(part * 2.2, (part % 2) * 0.65, 0);
        puff.parent = cloud;
        puff.material = cloudMaterial;
        puff.isPickable = false;
      }
      this.clouds.push(cloud);
    }
  }

  private refreshMaterialSelection(): void {
    this.zoneMaterials.forEach((material, index) => {
      material.emissiveColor = index === this.selectedZone ? new Color3(0.025, 0.16, 0.17) : Color3.Black();
    });
  }

  update(state: PlantState, zones: ZoneState[], cloudCover: number): void {
    this.cloudCover = cloudCover;
    const angle = (state.tracker_angle_deg * Math.PI) / 180;
    this.trackers.forEach((tracker) => { tracker.rotation.x = -angle; });
    zones.forEach((zone, index) => {
      const material = this.zoneMaterials[index];
      if (zone.alarm) {
        material.albedoColor = new Color3(0.25, 0.055, 0.025);
        material.emissiveColor = new Color3(0.18, 0.025, 0.005);
      } else {
        material.albedoColor = zone.available ? new Color3(0.025, 0.11, 0.20) : new Color3(0.07, 0.075, 0.075);
        material.emissiveColor = index === this.selectedZone ? new Color3(0.025, 0.16, 0.17) : Color3.Black();
      }
    });
  }
}
