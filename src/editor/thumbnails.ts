import * as THREE from 'three';
import type { ModelRender } from '../runtime/modelRender';

/** Renders small transparent PNG previews of models with a private renderer. */
export class Thumbnailer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);

  constructor(size = 96) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size);
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#7d8794', 1.9));
    const sun = new THREE.DirectionalLight('#fff4e0', 1.8);
    sun.position.set(0.6, 1, 0.8);
    this.scene.add(sun);
  }

  /** Returns a PNG data URL, or '' for an empty model. */
  render(render: ModelRender): string {
    const { min, max } = render.bounds;
    const size = new THREE.Vector3(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    if (size.lengthSq() === 0) return '';
    const center = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    const radius = size.length() / 2;

    const mesh = render.createMesh();
    this.scene.add(mesh);
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.05;
    const dir = new THREE.Vector3(1, 0.8, 1.25).normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.lookAt(center);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.scene.remove(mesh);
    return url;
  }
}
