import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Tools } from "@babylonjs/core/Misc/tools.js";
import { Scene } from "@babylonjs/core/scene.js";

import type { TurbineState } from "./types";


function material(scene: Scene, name: string, color: Color3, specular = 0.08): StandardMaterial {
  const value = new StandardMaterial(name, scene);
  value.diffuseColor = color;
  value.specularColor = new Color3(specular, specular, specular);
  value.roughness = 0.82;
  return value;
}


export class TurbineScene {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly rotor: TransformNode;
  private readonly yawRoot: TransformNode;
  private readonly blades: Mesh[] = [];
  private targetRpm = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private displayedRpm = 0;
  private displayedYaw = 220;
  private displayedPitch = 12;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, {
      antialias: true,
      adaptToDeviceRatio: true,
      powerPreference: "high-performance",
    });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.025, 0.08, 0.105, 1);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.0018;
    this.scene.fogColor = new Color3(0.16, 0.28, 0.3);

    const camera = new ArcRotateCamera(
      "camera",
      Tools.ToRadians(145),
      Math.PI * 0.36,
      175,
      new Vector3(0, 75, 0),
      this.scene,
    );
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 72;
    camera.upperRadiusLimit = 260;
    camera.lowerBetaLimit = 0.15;
    camera.upperBetaLimit = Math.PI * 0.48;
    camera.wheelDeltaPercentage = 0.012;
    camera.panningSensibility = 0;

    const skyLight = new HemisphericLight("sky-light", new Vector3(0.1, 1, 0.2), this.scene);
    skyLight.intensity = 0.95;
    skyLight.diffuse = new Color3(0.6, 0.8, 0.84);
    skyLight.groundColor = new Color3(0.09, 0.16, 0.12);

    const sun = new DirectionalLight("sun", new Vector3(-0.45, -1, 0.35), this.scene);
    sun.position = new Vector3(80, 150, -80);
    sun.intensity = 1.45;
    const shadows = new ShadowGenerator(2048, sun);
    shadows.useBlurExponentialShadowMap = true;
    shadows.blurKernel = 24;

    const ground = MeshBuilder.CreateGround("ground", { width: 650, height: 650, subdivisions: 2 }, this.scene);
    ground.material = material(this.scene, "ground-material", new Color3(0.07, 0.17, 0.12));
    ground.receiveShadows = true;

    const servicePad = MeshBuilder.CreateCylinder("service-pad", { height: 0.2, diameter: 27, tessellation: 64 }, this.scene);
    servicePad.position.y = 0.11;
    servicePad.material = material(this.scene, "pad-material", new Color3(0.22, 0.27, 0.28));
    servicePad.receiveShadows = true;

    const towerMaterial = material(this.scene, "tower-material", new Color3(0.78, 0.84, 0.85), 0.22);
    const darkMaterial = material(this.scene, "dark-material", new Color3(0.055, 0.12, 0.14), 0.4);
    const bladeMaterial = material(this.scene, "blade-material", new Color3(0.9, 0.93, 0.93), 0.16);
    bladeMaterial.backFaceCulling = false;

    const tower = MeshBuilder.CreateCylinder(
      "tower",
      { height: 90, diameterTop: 4.3, diameterBottom: 9.6, tessellation: 48 },
      this.scene,
    );
    tower.position.y = 45;
    tower.material = towerMaterial;
    tower.receiveShadows = true;
    shadows.addShadowCaster(tower);

    const door = MeshBuilder.CreateBox("tower-door", { width: 2.2, height: 4.2, depth: 0.25 }, this.scene);
    door.position = new Vector3(0, 2.3, -4.65);
    door.material = darkMaterial;

    this.yawRoot = new TransformNode("yaw-root", this.scene);
    this.yawRoot.position.y = 93;
    const nacelle = MeshBuilder.CreateBox("nacelle", { width: 7.4, height: 6.2, depth: 15.5 }, this.scene);
    nacelle.parent = this.yawRoot;
    nacelle.position = new Vector3(0, 1.2, 0.7);
    nacelle.material = towerMaterial;
    shadows.addShadowCaster(nacelle);

    const generatorBand = MeshBuilder.CreateBox("generator-band", { width: 7.55, height: 1.3, depth: 4.3 }, this.scene);
    generatorBand.parent = this.yawRoot;
    generatorBand.position = new Vector3(0, 1.2, 2.2);
    generatorBand.material = darkMaterial;

    this.rotor = new TransformNode("rotor", this.scene);
    this.rotor.parent = this.yawRoot;
    this.rotor.position = new Vector3(0, 1.2, -7.6);

    const hub = MeshBuilder.CreateSphere("hub", { diameter: 6.2, segments: 24 }, this.scene);
    hub.parent = this.rotor;
    hub.material = towerMaterial;
    shadows.addShadowCaster(hub);

    for (let index = 0; index < 3; index += 1) {
      const bladeRoot = new TransformNode(`blade-root-${index}`, this.scene);
      bladeRoot.parent = this.rotor;
      bladeRoot.rotation.z = index * (Math.PI * 2 / 3);
      const blade = MeshBuilder.CreateRibbon(
        `blade-${index}`,
        {
          pathArray: [
            [new Vector3(-1.65, 2.3, 0), new Vector3(-1.15, 14, 0), new Vector3(-0.36, 37, 0)],
            [new Vector3(1.65, 2.3, 0), new Vector3(1.05, 14, 0), new Vector3(0.24, 37, 0)],
          ],
          sideOrientation: Mesh.DOUBLESIDE,
        },
        this.scene,
      );
      blade.parent = bladeRoot;
      blade.material = bladeMaterial;
      shadows.addShadowCaster(blade);
      this.blades.push(blade);
    }

    const transformer = MeshBuilder.CreateBox("transformer", { width: 12, height: 5, depth: 7 }, this.scene);
    transformer.position = new Vector3(27, 2.55, 14);
    transformer.material = darkMaterial;
    shadows.addShadowCaster(transformer);

    this.engine.runRenderLoop(() => {
      const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.1);
      this.animate(dt);
      this.scene.render();
    });
    window.addEventListener("resize", () => this.engine.resize());
  }

  update(state: TurbineState): void {
    this.targetRpm = state.rotor_rpm;
    this.targetYaw = state.nacelle_yaw_deg;
    this.targetPitch = state.pitch_deg;
  }

  private animate(dt: number): void {
    const blend = 1 - Math.exp(-dt * 3.5);
    this.displayedRpm += (this.targetRpm - this.displayedRpm) * blend;
    this.displayedPitch += (this.targetPitch - this.displayedPitch) * blend;
    const yawDelta = (this.targetYaw - this.displayedYaw + 540) % 360 - 180;
    this.displayedYaw = (this.displayedYaw + yawDelta * blend + 360) % 360;
    this.rotor.rotation.z -= this.displayedRpm * Math.PI * 2 / 60 * dt;
    this.yawRoot.rotation.y = Tools.ToRadians(-this.displayedYaw);
    const pitchRadians = Tools.ToRadians(this.displayedPitch);
    for (const blade of this.blades) blade.rotation.y = pitchRadians;
  }
}
