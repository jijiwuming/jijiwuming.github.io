import {
  PerspectiveCamera,
  Fog,
  Scene,
  Color,
  TextureLoader,
  PlaneGeometry,
  ShaderMaterial,
  Mesh,
  WebGLRenderer,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
export function CloudMask(parentDom, canvasStyle) {
  // 云的个数
  const CloudCount = 800;
  // 每个云所占z轴的长度
  const perCloudZ = 15;
  // 所有的云一共的Z轴长度
  const cameraPositionZ = CloudCount * perCloudZ;
  // X轴和Y轴平移的随机参数
  const RandomPositionX = 100;
  const RandomPositionY = 80;
  let camera, scene, renderer, mesh, StartTime;
  function init() {
    StartTime = Date.now();
    const pageWidth = Math.min(parentDom.clientWidth, window.screen.availWidth);
    const pageHeight = Math.min(
      parentDom.clientHeight,
      window.screen.availHeight
    );
    // 透视相机，只有距离相机1~500的物体才可以被渲染
    camera = new PerspectiveCamera(45, pageWidth / pageHeight, 1, 200);
    // 相机的位置，平移下左右平衡
    camera.position.x = Math.floor(RandomPositionX / 2);
    // 最初在最远处
    camera.position.z = cameraPositionZ;

    // 线性雾，就是说雾化效果是随着距离线性增大的
    // 可以改变雾的颜色，发现远处的云的颜色有所变化
    const FogColor = "#fff";
    const fog = new Fog(FogColor, 1, 1000);

    scene = new Scene();
    // 背景色，目前为灰色
    const BackGroundColor = "#d3d3d3";
    // scene.background = new Color(BackGroundColor);

    const texture = new TextureLoader().load("/images/cloud.png");

    // 一个平面形状
    const geometry = new PlaneGeometry(64, 64);
    const geometries = [];

    const vShader = `
          varying vec2 vUv;
          void main()
          {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          }
        `;
    const fShader = `
          uniform sampler2D map;
          uniform vec3 fogColor;
          uniform float fogNear;
          uniform float fogFar;
          varying vec2 vUv;
          void main()
          {
            float depth = gl_FragCoord.z / gl_FragCoord.w;
            float fogFactor = smoothstep( fogNear, fogFar, depth );
            gl_FragColor = texture2D(map, vUv );
            gl_FragColor.w *= pow( gl_FragCoord.z, 20.0 );
            gl_FragColor = mix( gl_FragColor, vec4( fogColor, gl_FragColor.w ), fogFactor );
          }
        `;
    // 贴图材质
    const material = new ShaderMaterial({
      // 这里的值是给着色器传递的
      uniforms: {
        map: {
          type: "t",
          value: texture,
        },
        fogColor: {
          type: "c",
          value: fog.color,
        },
        fogNear: {
          type: "f",
          value: fog.near,
        },
        fogFar: {
          type: "f",
          value: fog.far,
        },
      },
      vertexShader: vShader,
      fragmentShader: fShader,
      transparent: true,
    });

    for (let i = 0; i < CloudCount; i++) {
      let temp = Math.random() * 3 + 2;
      for (let j = 0; j < temp; j++) {
        const instanceGeometry = geometry.clone();

        // 把这个克隆出来的云，通过随机参数，做一些位移，达到一堆云彩的效果，每次渲染出来的云堆都不一样
        // X轴偏移后，通过调整相机位置达到平衡
        let tx = Math.random() * RandomPositionX;
        let ty = Math.random() * RandomPositionY;
        // Y轴想把云彩放在场景的偏下位置，所以都是负值
        if (ty > 0.3 * RandomPositionY) {
          ty = 0.3 * RandomPositionY - ty;
        }
        // Z轴位移就是：当前第几个云*每个云所占的Z轴长度
        instanceGeometry.translate(tx, ty, i * perCloudZ);

        geometries.push(instanceGeometry);
      }
    }

    // 把这些形状合并
    const mergedGeometry = mergeGeometries(geometries);

    // 把上面合并出来的形状和材质，生成一个物体
    mesh = new Mesh(mergedGeometry, material);
    // 添加进场景
    scene.add(mesh);

    renderer = new WebGLRenderer({ antialias: false, alpha: true });
    renderer.setSize(pageWidth, pageHeight);
    renderer.domElement.style = canvasStyle;
    // 添加到父元素中
    parentDom.appendChild(renderer.domElement);
  }
  function animate() {
    requestAnimationFrame(animate);

    // 从最远的z轴处开始往前一点一点的移动，达到穿越云层的目的
    camera.position.z =
      cameraPositionZ - (((Date.now() - StartTime) * 0.03) % cameraPositionZ);

    renderer.render(scene, camera);
  }
  function destory() {
    parentDom.removeChild(renderer.domElement);
  }
  function startLoading() {
    init();
    animate();
  }
  return {
    startLoading,
    destory,
  };
}
