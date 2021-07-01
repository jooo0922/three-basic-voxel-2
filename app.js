'use strict';

import * as THREE from 'https://threejsfundamentals.org/threejs/resources/threejs/r127/build/three.module.js';

import {
  OrbitControls
} from 'https://threejsfundamentals.org/threejs/resources/threejs/r127/examples/jsm/controls/OrbitControls.js';

/**
 * 1번 예제는 로드하는 데 시간도 오래걸리고 카메라를 움직이면 버벅거림.
 * 당연한 것이, 256*256개의 육면체를 렌더링하니까 그렇지...
 * 
 * 여기에 만약 height값보다 낮은 지점을 복셀 메쉬로 전부 채워준다면? out of memory 에러가 뜸.
 * 이런 문제가 생기는 가장 큰 원인은, 화면에서 전혀 보이지 않는 정육면체의 안쪽 지점, 복셀과 복셀이 맞닿는 면, 이런 부분들도 렌더링을 해주는 게 문제!
 * 복셀 밖에서는 전혀 볼 일이 없는 불필요한 면들이 많아질수록 성능이 안좋아짐.
 * 
 * 이거를 해결하려면 geometry를 합치는 방법도 안될 것이고, 아예 서로 마주보는 면을 만들지 않도록 직접 복셀을 만드는 게 나음.
 * 문제는, 256*256*256 사이즈 복셀영역이 너무 크다는 거. 메모리 점유율도 크고...
 * 
 * 그래서 일단 복셀영역을 작은 영역으로 몇 조각씩 쪼개주는거임.
 * 이번 예제에서는 32*32*32크기의 영역만 따로 뗴어내서 복셀을 만들어볼거임.
 * 아래부터는 32*32*32 영역을 편의상 'cell'이라고 부를 것.
 * 
 * 아래의 VoxelWorld는 복셀 데이터를 관리할 클래스임.
 * 이 클래스에서는 할당된 cellSize 만큼의 cellSize*cellSize*cellSize개의 Uint8Array 형식화 배열을 만들어놓고, 거기에
 * (0, 0, 0) 지점의 첫번째 cell 범위의 복셀들 중에서 cell 바닥에서부터 사인 함수로 그린 언덕곡선 영역 밑까지의 복셀에 해당하는지 여부를 0 또는 1로 지정해 줌.
 * 그래서 해당 영역 내에 존재하는 복셀이라면, 각 복셀들 주변의 6면을 확인해서 첫번째 cell의 buffetGeometry를 만드는 데 필요한 '겉부분 면'인지 확인함.
 * 겉부분 면이 맞다면, positions, normals, indices에다가 bufferGeometry에 넘겨줄 해당 면의 버텍스 좌표값, 버텍스 노말값, 버텍스 인덱스값들을 추가해 줌.
 * 이런 식으로 첫번째 cell의 '겉부분 면으로만 이루어진 buffetGeometry'를 생성할 때 필요한 좌표값, 노멀값, 인덱스값들 저장해놓음.
 */

class VoxelWorld {
  constructor(options) {
    this.cellSize = options.cellSize;
    this.tileSize = options.tileSize; // 텍스처 안의 각 타일 1장의 크기
    this.tileTextureWidth = options.tileTextureWidth; // 텍스처 전체 너비
    this.tileTextureHeight = options.tileTextureHeight; // 텍스처 전체 높이

    const {
      cellSize
    } = this; // 위의 options에서 가져온 cellSize값이 할당된 this.cellSize 프로퍼티의 값을 const cellSize에 다시 가져온 것... 뭐하러 이렇게 하는지 참...
    this.cellSliceSize = cellSize * cellSize; // 해당 복셀이 몇번째 복셀인지 계산할 때, 복셀의 y좌표값에 곱해서 몇번째 층에 있는 복셀인지 우선 구하기 위해 곱해주는 값.
    this.cells = {}; // 복셀을 추가하면, 추가하는 복셀이 첫번째 셀에 해당하는지 확인하고, 그렇지 않다면 새로운 셀의 형식화 배열을 생성해야 하므로, 여러 개의 셀 형식화 배열들을 만들어서 담아놓기 위한 객체를 만들어놓음.
  }

  // 전달받은 복셀좌표값이 몇 번째 셀에 포함되는지 해당 셀의 id값을 'x, y, z'좌표값 문자열 형태로 계산하여 리턴해주는 메서드
  computeCellId(x, y, z) {
    const {
      cellSize
    } = this;
    const cellX = Math.floor(x / cellSize);
    const cellY = Math.floor(y / cellSize);
    const cellZ = Math.floor(z / cellSize);
    return `${cellX}, ${cellY}, ${cellZ}`;
  }

  // 전달받은 복셀좌표값이 몇번째 셀에 포함되는지 해당 셀의 id값을 계산하여 리턴받은 뒤, 해당 id값과 일치하는 셀의 형식화배열을 this.cells에서 가져와서 리턴해주는 메서드
  // 왜 이렇게 하냐면, 우리가 이제 복셀을 '추가'하는 기능까지 만들거기 때문에, 첫번째 셀의 복셀만이 아니라, 그 외의 셀에 포함되는 복셀까지 렌더해줘야 하는 상황도 생기는 것임.
  // 그렇기 때문에 추가하고자 하는 위치의 복셀이 포함된 셀의 형식화 배열이 뭔지 구분한 뒤, 셀에 따라 id값을 부여해놓고, 해당 id값과 일치하는 형식화배열을 가져오려는 것.
  getCellForVoxel(x, y, z) {
    return this.cells[this.computeCellId(x, y, z)];
  }

  // getVoxel, setVoxel에서 각 복셀이 몇번째인지 계산하는 코드가 중복되서 그거룰 하나의 메서드로 묶어서 정리해준 것.
  computeVoxelOffset(x, y, z) {
    const {
      cellSize,
      cellSliceSize
    } = this;

    // MathUtils.euclideanModulo(x, cellSize) 이렇게 해주면, '유클리드 나머지값'을 계산해 줌. 즉, ((x % cellSize) + cellSize) % cellSize 이 공식으로 나머지값을 계산해준다는 것.
    // 물론 x, y, z는 첫번째 cell의 복셀좌표값 범위 내에 있으므로, 모든 값은 결국 cellSize(32)보다 작을테니 각각 x, y, z값이 그대로 리턴되겠지. 이 리턴된 값을 비트연산자로 소수점 제거를 해줌. 근데 euclideanModulo() 메서드 자체가 정수값만 리턴해줘서 굳이 저걸 해줄 필요는 없긴 함...
    const voxelX = THREE.MathUtils.euclideanModulo(x, cellSize) | 0;
    const voxelY = THREE.MathUtils.euclideanModulo(y, cellSize) | 0;
    const voxelZ = THREE.MathUtils.euclideanModulo(z, cellSize) | 0;
    return voxelY * cellSliceSize + voxelZ * cellSize + voxelX; // 전달받은 복셀좌표값을 이용해서 형식화배열에서 사용할 인덱스값을 구해서 리턴해 줌.
    // 왜 이렇게 구해지냐? 복셀을 Y축 방향으로 여러 층 썰었다고 생각해보면 이해가 쉬움. 그럼 XZ방향으로 cellSize * cellSize(즉, cellSliceSize)한 값에다가(이게 한 층) Y축 방향으로 몇 번째 층인지를 우선 알아야 하니 cellSize * cellSize * y 를 해줘야지?
    // 그리고 나서 해당 층 내에서 Z축 방향으로 몇번째 줄인지 계산해야 하므로 cellSize * z를 더해줌. 여기에 마지막으로 X축 방향으로 몇번째 복셀인지 알아야 하니까 x를 더해줌. 이런식으로 복셀좌표값이 전체 cell 내에서 몇번째 복셀인지를 구해주는거임.
  }

  // 전달받은 복셀좌표값이 포함된 cell의 형식화 배열이 있어야 할 자리인 this.cells[this.computeCellId(x, y, z)]를 가져온 뒤, 형식화 배열이 만들어져 있는지 확인함.
  // 형식화 배열이 있으면 해당 셀에서 해당 복셀이 몇번째인지 인덱스를 계산해서 해당 셀의 형식화 배열에 1~16 사이에 랜덤으로 전달받은 값을 지정해주고,
  // 형식화 배열이 없으면 addCellForVoxel() 메서드를 호출해서 전달받은 복셀이 포함된 영역의 새로운 셀 형식화배열을 만들어준 뒤 v값을 지정해줘야 함. 
  // 생성자에서 this.cells = {} 에는 아무런 형식화배열도 추가하지 않은 상태이므로, 맨 처음 첫번째 cell의 geometry를 만들려고 할 때 첫번째 셀의 형식화 배열을 만들어줬을거고,
  // 그 다음부터 첫번째 cell 바깥쪽에 복셀들을 하나씩 추가할 때마다 해당 복셀이 포함된 cell이 만들어져 있는지 아닌지 확인하고 새로운 cell 형식화 배열을 만들어주겠지!
  setVoxel(x, y, z, v) {
    let cell = this.getCellForVoxel(x, y, z); // 언덕 곡선을 만드는 3중 for loop에서 받은 복셀좌표값이 첫번째 (0, 0, 0)지점 cell 범위에 해당하는 복셀인지 확인받음.
    if (!cell) {
      cell = this.addCellForVoxel(x, y, z);
    }

    const voxelOffset = this.computeVoxelOffset(x, y, z);

    cell[voxelOffset] = v; // (0, 0, 0)지점의 첫번째 셀 범위에 드는 복셀들 중에서, 언덕 곡선 밑까지의 복셀좌표값만 형식화배열에 랜덤으로 전달받은 1~16사이의 값을 지정해 줌.
  }

  // 넘겨받은 복셀좌표값이 포함된 cell 형식화배열이 아직 만들어지지 않은 상태라면 해당 cell의 형식화배열을 새로 만들어서 this.cells에 추가해준 뒤, 새로 만든 cell의 형식화배열을 리턴해주는 메서드
  addCellForVoxel(x, y, z) {
    const cellId = this.computeCellId(x, y, z);
    let cell = this.cells[cellId];

    if (!cell) {
      const {
        cellSize
      } = this;
      cell = new Uint8Array(cellSize * cellSize * cellSize);
      this.cells[cellId] = cell;
    }

    return cell;
  }

  // setVoxel 메서드가 미리 지정해놓은 형식화배열의 값들 중 전달받은 복셀좌표값의 값을 가져오는 메서드. 전달받은 복셀이 첫번째 cell의 범위에도 해당되고, 언덕곡선 영역 아래까지 존재하는 복셀들 중 하나라면 1~16 중 하나를 리턴받게 될거고, 그게 아닌 경우는 전부 0을 리턴받을거임. 
  // 또는 첫번째 cell이 아니어도, 전달받은 복셀이 포함된 cell의 형식화배열이 만들어져 있다면, 마찬가지로 랜덤값을 리턴받고, 그게 없다면 0을 리턴받겠지 뭐.
  getVoxel(x, y, z) {
    const cell = this.getCellForVoxel(x, y, z);
    if (!cell) {
      // 전달받은 복셀좌표값이 첫번째 cell의 복셀좌표값 범위에 해당하지 않거나 전달받은 복셀이 포함된 cell의 형식화배열이 만들어져 있지 않다면 그냥 0을 리턴해주고 메서드를 끝냄.
      return 0;
    }

    const voxelOffset = this.computeVoxelOffset(x, y, z);

    return cell[voxelOffset]; // 형식화배열에서 해당 번째 복셀에 지정된 값(0 또는 1~16사이의 값)이 리턴될거임. 이거는 setVoxel에서 미리 다 지정해놓은 상태임.
    // 이거는 뭘 기준으로 0 또는 랜덤값이 정해지는걸까? 첫번째 cell의 바닥에서부터 sin 함수로 만들어놓은 곡선 언덕까지의 복셀들만 1~16 사이의 랜덤값으로 정하고, 나머지 복셀들은 0으로 지정함. 그니까 첫번째 cell의 모든 복셀이 랜덤값으로 지정되지는 않는 것.
    // 왜냐면 사인 함수로 곡선 언덕을 만드는 3중 for loop에서 해당 영역 안에 위치한 좌표값들만 setVoxel에 전달하면서 호출하기 때문에, setVoxel은 그렇게 전달받은 복셀좌표값들만 형식화배열에 랜덤값으로 지정함.
    // 또는 새롭게 추가한 복셀이 포함된 cell의 형식화 배열이 만들어져 있는 애들만 형식화배열에 랜덤값을 저장함.
    // 이렇게 랜덤값으로 지정된 복셀들만 generateGeometryDateForCell에서 이웃한 6개의 면들 중 '겉부분 면'이 있는지 확인받을 자격이 생기는 것임.
  }

  // 만들고자 하는 cell의 위치값을 인자로 받아서 해당 cell 안에 존재하는 복셀 좌표값들을 구한 뒤, 걔내들로 cell의 bufferGeometry를 생성하는 데 필요한 positions, normals, indices, uvs 값들을 계산해 줌.
  generateGeometryDateForCell(cellX, cellY, cellZ) {
    const {
      cellSize,
      tileSize,
      tileTextureWidth,
      tileTextureHeight
    } = this; // 생성자에 위치한 값들을 가져오는 것. 굳이 이렇게 안해도 될 듯 한데..

    // cell 안에만 존재하는 복셀 좌표값들로 구한 cell의 bufferGeometry의 '겉부분 면'의 버텍스 좌표값, 노말값, uv값, 인덱스값들을 담아놓을 배열
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    // 예를 들어, (0, 0, 0)을 cell의 위치값으로 받아오면, cell의 첫번째 복셀의 좌표값은 (0*32, 0*32, 0*32)니까 (0, 0, 0)이 되겠지.
    // 그래서 이 값들부터 시작해서 아래의 3중 for loop를 이용해서 (0, 0, 0) ~ (31, 31, 31)까지의 좌표값들을 구한 뒤, (0, 0, 0)에 위치한 cell의 bufferGeometry에 필요한 positions, normals, indices 값들을 계산하려는 것.
    const startX = cellX * cellSize;
    const startY = cellY * cellSize;
    const startZ = cellZ * cellSize;

    for (let y = 0; y < cellSize; y++) {
      const voxelY = startY + y;

      for (let z = 0; z < cellSize; z++) {
        const voxelZ = startZ + z;

        for (let x = 0; x < cellSize; x++) {
          const voxelX = startX + x;
          const voxel = this.getVoxel(voxelX, voxelY, voxelZ); // 해당 복셀 좌표값이 포함되는 cell에 형식화배열이 만들어져 있는지 확인하고, 형식화 배열이 존재한다면, 전달한 좌표값으로 구한 인덱스로 this.cell 형식화배열에 담긴 값을 리턴받음. (setVoxel에 의해 이미 0 또는 랜덤값이 할당되어 있을거임) 

          // if block을 통과하는 복셀 좌표값들은 각 복셀들이 포함되는 cell의 형식화배열에 0이 아닌 값이 지정된 복셀들임. 
          if (voxel) {
            // uvVoxel값은 뭐냐면, 해당 복셀의 uv좌표값 중에서 시작점인 u값을 구하기 위해 필요한 값임.
            // 즉, setVoxel에 의해 형식화배열에 1 ~ 16 중 하나의 값이 랜덤으로 저장된 voxel을 가져와서, 1을 빼준 값을 uvVoxel에 저장하면 0 ~ 15 사이의 값이 들어가겠지?
            // 얘내들은 텍스처에서 각 타일들의 왼쪽 상단 uv좌표값의 u값을 계산하기 위해 구해놓은 값임. 
            const uvVoxel = voxel - 1;
            for (const {
                dir,
                corners,
                uvRow,
              } of VoxelWorld.faces) {
              // 각 복셀 좌표값의 왼,오,위,아래,뒤,앞에 존재하는 면들의 위치값(노멀값)을 구한 뒤, 걔내가 첫 번째 (0, 0, 0)지점의 cell 안에 존재하는 면의 위치값, 즉 cell 안에 존재하는 어떤 복셀의 면 중 하나인지 판단함.
              const neighbor = this.getVoxel(
                voxelX + dir[0],
                voxelY + dir[1],
                voxelZ + dir[2],
              );

              if (!neighbor) {
                // neighbor = 0 인 경우, 위에서 계산한 복셀 주변의 면은 cell 안에 존재하는 복셀의 면이 아니라는 것. 즉, cell 덩어리에서 가장 '겉부분'에 위치하는 면이라는 뜻! 
                // -> 우리가 안쪽의 면은 렌더링 해주지 않기로 했으니까, 이 겉부분의 면만 렌더링 해주면 됨. 따라서 이 겉부분 면의 버텍스들의 좌표값(위치값 아님. corners값으로 구하는 좌표값), 버텍스 normal(버텍스들이 향하는 방향)값, 버텍스 indices값(vertex 좌표값 배열에서 어느 좌표값을 찾아야 할 지 알려주는 인덱스값)을 구함.
                const index = positions.length / 3; // positions에는 하나의 면에 대해 12개의 버텍스 좌표값들이 push됨(왜? 한 면의 버텍스가 4개니까). 따라서 면 하나를 이루는 버텍스 개수, 즉 4의 배수를 버텍스 인덱스의 시작점으로 정해줌.

                for (const {
                    pos,
                    uv, // corners에는 각 버텍스 좌표값에 맞게 씌워줄 텍스처의 uv좌표값을 짝지어 놓았으니까 같이 가져옴.
                  } of corners) {
                  positions.push(pos[0] + x, pos[1] + y, pos[2] + z); // 이런 식으로 한 면을 이루는 4개의 버텍스 좌표값(x, y, z)를 구해서 positions에 추가해 줌.
                  normals.push(...dir); // 한 면에 있는 버텍스들은 모두 같은 방향을 바라보니까, 4개의 버텍스 모두 동일한 노말값(...dir)을 복사해서 normals에 넣어줌.
                  uvs.push(
                    /**
                     * 각 버텍스의 uv좌표값의 u값을 구한 뒤 추가해 줌.
                     * 
                     * 이때, uv[0]이 0 또는 1이므로, 0이면 각 타일의 왼쪽 상단의 u값, 1이면 각 타일의 오른쪽 상단의 u값이 계산될거임.
                     * 참고로 이 값을 tileSize/tileTextureWidth 값으로 곱해주기 때문에 0 ~ 1 사이의 값으로 계산됨. 왜냐? 원래 uv좌표값은 0 ~ 1사이의 값으로 표현해줘야 하기 때문임.
                     * 그래서 tileTextureWidth = tileSize(16) * 16 이기 때문에, tileSize에 곱해주는 값도 0 ~ 16 사이의 값이 나오도록 하는거임.
                     */
                    (uvVoxel + uv[0]) * tileSize / tileTextureWidth,
                    /**
                     * 각 버텍스의 uv좌표값의 v값을 구한 뒤 추가해 줌.
                     * 
                     * 이때, tileTextureHeight = tileSize(16) * 4 이고, 텍스처의 최하단 v값, 즉 4는 투명한 지점을 가리키니 필요가 없겠지? 
                     * 따라서 (uvRow + 1 - uv[1])는 uv[1]이 0이면 1, 2, 3이 나올거고, 1이면 0, 1, 2가 나올거임. 
                     * 그리고 나서 해당 값에다가 u값을 구할때처럼 tileSize / tileTextureHeight을 곱해주면 됨.
                     * 
                     * 근데 다 구하고 나서 왜 1에서 빼준걸까?
                     * 그거는 OpenGL vs DirectX의 텍스처 좌표계의 방향이 반대이기 때문임.
                     * DirectX는 텍스처의 왼쪽 상단이 (0, 0), 오른쪽 하단이 (1, 1)이지만,
                     * OpenGL은 텍스처의 왼쪽 하단이 (0, 0), 오른쪽 상단이 (1, 1)로 인식함.
                     * 따라서, three.js는 WebGL 기반이고, WebGL도 OpenGL 기반이므로, OpenGl의 텍스처 좌표계 방향을 따르는거임.
                     * 
                     * 만약 DirectX였으면 1에서 빼지 않은 값을 그대로 써도 아무런 문제가 없겠지만, WebGL은 텍스처 좌표계의 방향이 위아래가 반대이므로
                     * v값을 구할때는 항상 1(즉, 텍스처의 최상단 지점의 v값)에서 빼준 값으로 해줘야 함.
                     */
                    1 - (uvRow + 1 - uv[1]) * tileSize / tileTextureHeight
                  );
                }

                // 위에서 만든 각각 4개씩의 버텍스 좌표값(positions)과 버텍스 노말값(normals)들을 해당 배열에서 가져오기 위해 인덱스값을 계산해서 indices에 추가해 줌. 
                indices.push(
                  // 왜 버텍스는 4개를 만들었는데 6개의 인덱스값이 필요한걸까? 버텍스 4개, 즉 사각형은 삼각형 두 개로 이루어진거임. WebGL은 삼각형밖에 그릴 줄 모른다는 걸 명심해야 함.
                  // 그래서 사각형을 반으로 나눴을 때 나오는 두 개의 삼각형 각각의 버텍스들을 지정하려고 하다보니, 인덱스값이 6개가 나온거임.
                  index, index + 1, index + 2, // 하나의 삼각형 버텍스를 지정할 인덱스값들.
                  index + 2, index + 1, index + 3 // 다른 하나의 삼각형 버텍스를 지정할 인덱스값들. 사각형 내에서 두 삼각형은 버텍스 두개가 서로 교차하기 때문에, 위에 삼각형과 아래 삼각형도 두 개의 인덱스값이 겹침. 
                );
              }
            }
          }
        }
      }
    }

    // generateGeometryDateForCell 메서드 마지막에서 지금까지 구한 모든 복셀 좌표값들 중 첫번째 cell안에 들어가는 복셀 좌표값만 구하고, 그것들의 주변 면들 중 '겉부분 면'의 버텍스 관련 데이터들만 담아놓은 배열들을 묶어서 리턴해 줌.  
    return {
      positions,
      normals,
      uvs,
      indices
    };
  }

  // three.js의 내장 RayCaster 객체 대신 사용할 메서드로, 카메라의 전역 좌표값(start)와 pointerup 이벤트가 발생한 지점의 전역 좌표값(end)을 받아서 클릭한 지점과 교차하는 지점의 좌표값(position)과 노말값(normal)을 객체로 묶어 리턴해 줌.
  // 아래를 보니까 교차하는 지점이 없으면 null을 리턴해주는 것 같음. 
  // 참고로 이 메서드는 튜토리얼 웹사이트에서 보니 어떤 논문에서 코드를 그대로 가져온 것 같음. 구체적인 원리는 설명이 잘 안되어 있음ㅠ
  intersectRay(start, end) {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let dz = end.z - start.z;
    const lenSq = dx * dx + dy * dy + dz * dz;
    const len = Math.sqrt(lenSq);

    dx /= len;
    dy /= len;
    dz /= len;

    let t = 0.0;
    let ix = Math.floor(start.x);
    let iy = Math.floor(start.y);
    let iz = Math.floor(start.z);

    const stepX = (dx > 0) ? 1 : -1;
    const stepY = (dy > 0) ? 1 : -1;
    const stepZ = (dz > 0) ? 1 : -1;

    const txDelta = Math.abs(1 / dx);
    const tyDelta = Math.abs(1 / dy);
    const tzDelta = Math.abs(1 / dz);

    const xDist = (stepX > 0) ? (ix + 1 - start.x) : (start.x - ix);
    const yDist = (stepY > 0) ? (iy + 1 - start.y) : (start.y - iy);
    const zDist = (stepZ > 0) ? (iz + 1 - start.z) : (start.z - iz);

    // location of nearest voxel boundary, in units of t
    let txMax = (txDelta < Infinity) ? txDelta * xDist : Infinity;
    let tyMax = (tyDelta < Infinity) ? tyDelta * yDist : Infinity;
    let tzMax = (tzDelta < Infinity) ? tzDelta * zDist : Infinity;

    let steppedIndex = -1;

    // main loop along raycast vector
    while (t <= len) {
      const voxel = this.getVoxel(ix, iy, iz);
      if (voxel) {
        return {
          position: [
            start.x + t * dx,
            start.y + t * dy,
            start.z + t * dz,
          ],
          normal: [
            steppedIndex === 0 ? -stepX : 0,
            steppedIndex === 1 ? -stepY : 0,
            steppedIndex === 2 ? -stepZ : 0,
          ],
          voxel,
        };
      }

      // advance t to next nearest voxel boundary
      if (txMax < tyMax) {
        if (txMax < tzMax) {
          ix += stepX;
          t = txMax;
          txMax += txDelta;
          steppedIndex = 0;
        } else {
          iz += stepZ;
          t = tzMax;
          tzMax += tzDelta;
          steppedIndex = 2;
        }
      } else {
        if (tyMax < tzMax) {
          iy += stepY;
          t = tyMax;
          tyMax += tyDelta;
          steppedIndex = 1;
        } else {
          iz += stepZ;
          t = tzMax;
          tzMax += tzDelta;
          steppedIndex = 2;
        }
      }
    }
    return null;
  }
}

// cell의 bufferGeometry에서 각 복셀 좌표값 지점의 면을 생성하기 위해 필요한 positions, normals를 구하기 위해 필요한 값들을 모아놓음.
// uvRow는 텍스처에서 몇번째 줄에 있는 타일들을 사용할 것인지 알려주는 값. 옆면(왼, 오, 앞, 뒤)은 동일하게 텍스처 맨 윗줄의 타일들을 쓸거니까 0, 아랫면은 텍스처 가운데 줄 타일을 쓸거니까 1, 윗면은 텍스처 맨 아랫줄의 타일들을 쓸거니까 2
// dir은 generateGeometryDateForCell에서 생성한 cell안의 각 복셀 좌표값을 기준으로 왼,오,위,아래,뒤,앞에 존재하는 면의 위치값(또는 노멀값)을 구할 때 쓰는 값.
// corners의 pos는 복셀좌표값 기준 왼,오,위,아래,뒤,앞쪽의 면이 '겉부분 면'일 때, 해당 면의 버텍스(꼭지점) 4개의 좌표값을 구할 때 필요한 값
// corners의 uv는 각 버텍스 좌표값에 씌워줄 텍스처의 uv좌표값을 정리한 것
VoxelWorld.faces = [{ // 왼쪽
    uvRow: 0,
    dir: [-1, 0, 0, ],
    corners: [{
        pos: [0, 1, 0],
        uv: [0, 1],
      },
      {
        pos: [0, 0, 0],
        uv: [0, 0],
      },
      {
        pos: [0, 1, 1],
        uv: [1, 1],
      },
      {
        pos: [0, 0, 1],
        uv: [1, 0],
      },
    ],
  },
  { // 오른쪽
    uvRow: 0,
    dir: [1, 0, 0, ],
    corners: [{
        pos: [1, 1, 1],
        uv: [0, 1],
      },
      {
        pos: [1, 0, 1],
        uv: [0, 0],
      },
      {
        pos: [1, 1, 0],
        uv: [1, 1],
      },
      {
        pos: [1, 0, 0],
        uv: [1, 0],
      },
    ],
  },
  { // 아래
    uvRow: 1,
    dir: [0, -1, 0, ],
    corners: [{
        pos: [1, 0, 1],
        uv: [1, 0],
      },
      {
        pos: [0, 0, 1],
        uv: [0, 0],
      },
      {
        pos: [1, 0, 0],
        uv: [1, 1],
      },
      {
        pos: [0, 0, 0],
        uv: [0, 1],
      },
    ],
  },
  { // 위
    uvRow: 1,
    dir: [0, 1, 0, ],
    corners: [{
        pos: [0, 1, 1],
        uv: [1, 1],
      },
      {
        pos: [1, 1, 1],
        uv: [0, 1],
      },
      {
        pos: [0, 1, 0],
        uv: [1, 0],
      },
      {
        pos: [1, 1, 0],
        uv: [0, 0],
      },
    ],
  },
  { // 뒤
    uvRow: 0,
    dir: [0, 0, -1, ],
    corners: [{
        pos: [1, 0, 0],
        uv: [0, 0],
      },
      {
        pos: [0, 0, 0],
        uv: [1, 0],
      },
      {
        pos: [1, 1, 0],
        uv: [0, 1],
      },
      {
        pos: [0, 1, 0],
        uv: [1, 1],
      },
    ],
  },
  { // 앞
    uvRow: 0,
    dir: [0, 0, 1, ],
    corners: [{
        pos: [0, 0, 1],
        uv: [0, 0],
      },
      {
        pos: [1, 0, 1],
        uv: [1, 0],
      },
      {
        pos: [0, 1, 1],
        uv: [0, 1],
      },
      {
        pos: [1, 1, 1],
        uv: [1, 1],
      },
    ],
  },
];

function main() {
  // create WebGLRenderer
  const canvas = document.querySelector('#canvas');
  const renderer = new THREE.WebGLRenderer({
    canvas
  });

  const cellSize = 32; // cell 하나당 32*32*32만큼의 영역단위로 만들어주려는 거겠지

  // create camera
  const fov = 75;
  const aspect = 2;
  const near = 0.1;
  const far = 1000;
  const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.set(-cellSize * 0.3, cellSize * 0.8, -cellSize * 0.3); // cellSize로 카메라의 위치값을 구해놓음

  // create OrbitControls
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(cellSize / 2, cellSize / 3, cellSize / 2); // 마찬가지로 카메라의 시선을 고정시킬 좌표값도 cellSize로 구함.
  controls.update(); // OrbitControls의 값을 바꿔줬으면 업데이트를 호출해줘야 함.

  // 씬을 생성하고 배경색을 하늘색으로 지정함
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('lightblue');

  // 텍스처, cell과 관련된 값들을 지정함. 복셀 데이터를 관리하는 클래스 인스턴스 생성 시 전달하려는 것.
  const tileSize = 16;
  const tileTextureWidth = 256;
  const tileTextureHeight = 64;
  // 타일 이미지를 로드해서 텍스처를 생성함
  const loader = new THREE.TextureLoader();
  const texture = loader.load('./image/flourish-cc-by-nc-sa.png', render); // 텍스처 로드를 완료한 뒤에 onLoadFn으로 render 함수를 호출해줘야 로드한 텍스처가 반영된 프레임으로 다시 그려줄 수 있겠지
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter; // 원본이 텍스처보다 커지거나 작아지면 NearestFilter를 적용함

  // 직사광을 생성해서 씬에 추가하는 함수
  function addLight(x, y, z) {
    const color = 0xFFFFFF;
    const intensity = 1;
    const light = new THREE.DirectionalLight(color, intensity);
    light.position.set(x, y, z);
    scene.add(light);
  }
  addLight(-1, 2, 4);
  addLight(1, -1, -2); // 조명 두개를 추가함.

  const world = new VoxelWorld({ // 자세히 보면 4개의 값들을 객체로 묶어서 전달해주고 있지? 이 묶인 객체를 생성자에서 options로 받는거임.
    cellSize,
    tileSize,
    tileTextureWidth,
    tileTextureHeight,
  });

  // cell mesh를 만들 때 사용할 material을 생성함.
  const material = new THREE.MeshLambertMaterial({
    map: texture,
    side: THREE.DoubleSide, // 텍스처에서 몇몇 타일은 투명하게 되어있으므로, cell의 내부가 비쳐보일거임. 그래서 복셀들의 앞, 뒷면을 모두 렌더해야 cell의 내부가 비쳐보일때도 텍스처가 렌더된 내부 면들이 보이겠지.
    transparent: true, // 물체를 투명하게 렌더해주려면 우선 해당 속성을 켜줘야 함.
    alphaTest: 0.1, // png 텍스처 자체에 이미 각 tile 부분마다 투명도가 별개로 지정되어 있으므로, opacity가 아니라, alphaTest값을 0.1로 지정해 줌. 그래서 텍스처에서 투명도가 0.1보다 작은 픽셀은 렌더해주지 않고, 큰 픽셀은 투명도를 적용해서 렌더해줌.
  });

  // updateVoxelGeometry() 함수에서 전달받은 교차점 주변 좌표값이 포함된 cell이 이미 만들어진 cell mesh가 있는지 없는지 먼저 판단한 뒤(cellIdToMesh에 저장된 값을 보고 판단함),
  // 있다면, 기존 cell mesh의 bufferGeometry에 새롭게 값이 갱신된(예를 들어, 쉬프트키를 눌렀거나, allowUncheck() 함수에 의해 currentValue가 0이 되면, 기존 cell mesh에서 클릭한 복셀의 형식화배열 값이 0으로 지정됨.) BuffetAttribute만 setAttribute로 업데이트 해주고,
  // 없다면, 전달받은 교차점 주변 좌표값이 포함된 cell을 새롭게 만들어주고, 만들어준 cell의 id와 mesh를 key: value 쌍으로 cellIdToMesh에 저장해주도록 함. -> 그래서 다음에 또 updateCellGeometry가 호출되어도 이미 만들어진 cell인지 아닌지 확인할 수 있도록 함,
  const cellIdToMesh = {}; // 이미 만들어진 cell들이 cellId: mesh 형태로 저장될 객체
  function updateCellGeometry(x, y, z) {
    const cellX = Math.floor(x / cellSize);
    const cellY = Math.floor(y / cellSize);
    const cellZ = Math.floor(z / cellSize); // 전달받은 교차점 주변 좌표값이 포한된 cell의 위치값을 구함.
    const cellId = world.computeCellId(x, y, z); // 전달받은 교차점 주변 좌표값이 포함된 cellId를 계산함.
    let mesh = cellIdToMesh[cellId]; // 혹시 해당 cell이 이미 만들어진 mesh가 있는지 없는지 판단하기 위해 가져옴.
    const geometry = mesh ? mesh.geometry : new THREE.BufferGeometry(); // 이미 만들어진 cell이라면, 해당 cell mesh의 geometry를 가져오고, 그게 아니라면 새로운 BufferGeometry를 만듦.

    // (cellX, cellY, cellZ) 지점의 cell 메쉬에 사용될(또는 사용된) buffetGeometry에 전달할 버텍스 데이터들을 생성하여(또는 재생성) 리턴받음.
    const {
      positions,
      normals,
      uvs,
      indices
    } = world.generateGeometryDateForCell(cellX, cellY, cellZ);

    // 각 버텍스 데이터 배열들로 bufferAttribute 인스턴스를 생성한 뒤, 그거를 위에서 생성한 bufferGeometry에 추가해 줌. (이 부분은 bufferGeometry 예제 정리한 내용 참고하기)
    // 참고로 THREE.BufferAttribute()는 버텍스 데이터 배열을 형식화 배열로만 받음. 또한, 하나의 꼭지점에 대해 각 버텍스 데이터 배열에서 몇 개의 요소를 사용해야 하는지도 지정해줘야 함.
    const positionNumComponents = 3;
    geometry.setAttribute(
      'position', // 생성한 Attribute를 지정할 땐 Three.js가 원하는 속성의 이름을 써줘야 함. 
      new THREE.BufferAttribute(new Float32Array(positions), positionNumComponents)
    );
    const normalNumComponents = 3; // 버텍스 좌표값, 노말값 모두 하나의 꼭지점에 각각 x, y, z 총 3개의 요소를 사용하니까
    geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array(normals), normalNumComponents)
    );
    const uvNumComponents = 2; // 버텍스 uv값은 하나의 꼭지점마다 u, v 총 2개의 요소를 사용함.
    geometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Float32Array(uvs), uvNumComponents)
    );
    geometry.setIndex(indices); // 위에서 넘겨준 positions, normals 버텍스 데이터 배열을 인덱스로 참조하려면, .setIndex()에 버텍스 개수 만큼의 인덱스값들이 저장된 배열을 넘겨줘야 함.
    geometry.computeBoundingSphere(); // 해당 geometry를 둘러싼 boundingSphere 즉, 경계 구체를 계산해준다고 함. 
    // 근데 어디다가 쓸 것도 아닌데 굳이 계산해 줄 이유가 있나.. 아무레도 사용자 클릭에 따라 복셀이 추가, 제거되면 경계 구체가 계속 바뀔테니, 지오메트리를 업데이트 할때마다 수동으로 업데이트 해주려는 듯. 
    // 왜냐면 경계구체는 지오메트리가 바뀌어도 자동으로 계산되지 않기 때문...

    if (!mesh) {
      // cellIdToMesh에 해당 cell의 mesh가 없다면, 즉 아예 새롭게 만들어야 할 경우 if block으로 들어와서 새로운 cell mesh를 만들고 씬에 추가함.
      mesh = new THREE.Mesh(geometry, material); // 새로운 cell mesh를 만듦.
      mesh.name = cellId; // Object3D는 해당 물체의 이름을 선택적으로 지정할 수 있는 name 프로퍼티를 모두 갖고 있음. 그냥 새로 만든 cell mesh의 name을 cellId로 지정해준 것. 선택사항이라 반드시 안해줘도 됨. 
      cellIdToMesh[cellId] = mesh; // 새롭게 만든 cell mesh는 해당하는 cellId와 함께 cellIdToMesh에 추가해줘서, 다음에 이 함수가 또 호출되어도 지금 만든 이 cell mesh가 이미 만들어진 mesh임을 알려주도록 함. 
      scene.add(mesh); // 씬에 cell 메쉬를 추가함.
      mesh.position.set(cellX * cellSize, cellY * cellSize, cellZ * cellSize);
      // (cellX, cellY, cellZ)는 해당 cell의 실제 좌표값이라기 보다는, 해당 cell의 몇번째 cell인지를 구분하는, 일종의 id값의 역할을 하기 때문에,
      // 이 값으로 실제 cell의 위치값을 계산하려면, cellSize인 32를 곱해줘야 함. 즉, cellId가 '1, 0, 0'인 cell의 실제 위치값은 (32, 0, 0)이라고 할 수 있음.
    }
  }

  // 교차점 좌표값 자신, 앞, 뒤, 왼, 오, 위, 아래에 위치한 cell을 업데이트 해주기 위해 지정해놓은 오프셋 배열
  const neighborOffset = [
    [0, 0, 0], // 자신
    [-1, 0, 0], // 왼쪽
    [1, 0, 0], // 오른쪽
    [0, -1, 0], // 아래
    [0, 1, 0], // 위
    [0, 0, -1], // 뒤
    [0, 0, 1], // 앞
  ]

  // 전달받은 교차점 좌표값이 만약 cell의 가장자리라면, 하나의 cell의 겉부분에 또 다른 복셀을 만들어줘야 한다는 의미임. 그리고 또 다른 복셀은 당연히 또 다른 cell에 포함되어 있는 복셀이겠지. 따라서 그 또 다른 cell도 새로 만들어줘야 하는거고!
  // 이런 식으로 전달받은 교차점 자신, 앞, 뒤, 왼, 오, 위, 아래에 추가해줘야 하는 cell이 있는지 확인해서 새롭게 생성해야 한다면 updateCellGeometry()를 호출해서 새로운 cell을 생성해주는 함수.
  function updateVoxelGeometry(x, y, z) {
    const updatedCellIds = {};

    for (const offset of neighborOffset) {
      const ox = x + offset[0];
      const oy = y + offset[1];
      const oz = z + offset[2];
      const cellId = world.computeCellId(ox, oy, oz);
      if (!updatedCellIds[cellId]) {
        // 위에 교차점 주변 7개의 좌표값들 중 이미 앞에 for...of 반복순회에서 새롭게 생성하여 업데이트된 cell의 id값이 중복 계산되어 들어왔다면, if block을 통과하지 않을 것이고,
        // 7개의 주변 좌표값들이 포함된 cell들 중 새로 생성해줘야 하는 cell이 있다면 if block을 들어와서 updatedCellIds를 true로 해서 이제 업데이트가 완료된 상태임을 알려놓고, updateCellGeometry() 함수를 호출해서 새로운 cell을 생성함.
        // 근데 일단 for...of 문에서 가장 먼저 들어오는 [0, 0, 0]이 더해진 교차점 좌표값, 즉 교차점 좌표값이 포함되는 cell영역은 기본적으로 update를 한 번씩 해줌. 
        // 그래서 만약에 placeVoxel() 함수에서 setVoxel로 0을 지정했다면 기존의 cell geometry에서 0으로 지정된 복셀을 제거해줘야 할 필요도 있으니 updateCellGeometry를 호출해줘야 하는 것이고!
        // 이럴 경우의 좌표값은 placeVoxel() 함수에서도 봐서 알겠지만, 0.5가 곱해진 노말값이 더해진 좌표값을 넘겨받잖아? 이거는 결국 클릭한 복셀이 포함된 cell, 즉, (0, 0, 0) 지점에 위치한 첫번째 셀에 포함된 좌표값일테니, 그 첫번째 셀이 업데이트 되는거임! -> 이렇게 이해하면 대충 코드의 큰 그림이 맞아떨어지지
        // 어찌됬건 7개 좌표값들 중 맨 첫번째 좌표값이 포함된 cell은 무조건 업데이트가 된다고 보면 됨. 그 이후에 나머지 6개 좌표값들이 포함된 cell이 이전에 업데이트된 것과 중복되는 cell이면 업데이트 안해주고, 또 다른 방향에 인접한 cell이라면 새로 만들어줘야 하는 것이지.
        updatedCellIds[cellId] = true;
        updateCellGeometry(ox, oy, oz);
      }
    }
  }

  // 사인 함수 곡선을 이용하여, 각 x,z좌표값들 별 언덕곡선을 만드는 데 필요한 높이값들을 계산하고, 각 높이값 아래까지의 x, y, z좌표값들만
  // '겉부분 면'을 확인할 자격을 얻는 복셀좌표값으로 추가해주는 3중 for loop. 물론 추가해주는 건 setVoxel 메서드가 해줌.
  for (let y = 0; y < cellSize; y++) {
    for (let z = 0; z < cellSize; z++) {
      for (let x = 0; x < cellSize; x++) {
        // x, z좌표값별로 언덕 곡선을 만들기 위해 필요한 높이값들을 각각 계산해 줌.
        const height = (Math.sin(x / cellSize * Math.PI * 2) + Math.sin(z / cellSize * Math.PI * 3)) * (cellSize / 6) + (cellSize / 2);

        if (y < height) {
          // 각 높이값 아래에만 있는 (x, y, z) 지점의 복셀들만 world의 형식화배열에 1 ~ 16 중 하나의 랜덤한 정수값을 지정해줌으로써,
          // 해당 복셀들만 generateGeometryDateForCell 메서드에서 '겉부분 면'을 확인할 자격을 얻음. 왜냐? 0이 아닌 값으로만 지정해주면 generateGeometryDateForCell 메서드의 if block을 통과할 수 있으니까 
          world.setVoxel(x, y, z, randomInt(1, 17));
        }
      }
    }
  }

  function randomInt(min, max) {
    // 위에 setVoxel 메서드에서 인자로 넘겨줄 값을 계산하기 위해 호출할 때, min, max로 각각 1, 17을 받으므로,
    // 0 이상 1 미만의 실수인 난수를 리턴하는 random() 메서드에 의해 1.xxx ~ 16.xxx 이런 값이 리턴될거고, 이거를 소수점 제거하니까 결과적으로는 1 ~ 16 사이의 정수값을 리턴해준다는 거지.
    return Math.floor(Math.random() * (max - min) + min);
  }

  // (1, 1, 1)위치에 있는 복셀은 '0, 0, 0'에 해당하는 cell 영역 내에 있겠지? 왜냐면 저 cell은 (0~31, 0~31, 0~31) 사이의 복셀들을 포함하니까!
  // 따라서 이 복셀좌표값을 넘겨주면서 updateVoxelGeometry를 호출하면, '0, 0, 0'에 해당하는 첫번째 cell의 형식화배열에 랜덤값이 지정된 복셀들을 이용해서 cell mesh를 만들겠지!
  // 그래서 처음에 코드를 실행할때는 사용자가 어떤 복셀에 대해 클릭이벤트를 주지 않더라도, 첫번째 cell인 '0, 0, 0'은 미리 생성될거임. 
  // 물론, 앞의 3중 for loop에 의해서, (0~31, 0~31, 0~31) 사이의 복셀들은 모두 해당하는 cell(즉, 첫번째 cell)의 형식화배열에 랜덤값이 지정되어 있으므로, 이 복셀들은 모두 렌더가 될거임. 
  updateVoxelGeometry(1, 1, 1);

  // resize renderer
  function resizeRendererToDisplaySize(renderer) {
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
      renderer.setSize(width, height, false);
    }

    return needResize;
  }

  let renderRequested = false; // OrbitControls.update()에 의해 render 함수가 호출된건지 판별하는 변수

  // render
  function render() {
    renderRequested = undefined; // 변수를 초기화함.

    // 렌더러가 리사이징되면 그에 맞게 카메라 비율(aspect)도 업데이트 해줌
    if (resizeRendererToDisplaySize(renderer)) {
      const canvas = renderer.domElement;
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix(); // 카메라의 속성값을 바꿔주면 업데이트를 호출해야 함.
    }

    controls.update(); // camera transform(위치값, 각도 등)에 변화가 생기면 update loop 안에서 호출해줘야 함. 

    renderer.render(scene, camera);
  }
  render(); // 일단 페이지 첫 로드 시 뭐가 보여야 되니까 render 함수를 최초 호출해준 것.

  // render 함수 실행 도중 카메라가 또 움직여서 render 함수호출예약을 했는데(그래서 renderRequested = true인 상태), render 함수 내에서 마침 controls.update()에 의해 또 render함수를 중복예약 하려들수도 있음.
  // 이때 '이미 한 번 예약됬어~' 라고 말해주는 게 renderRequested = true인 상태임. 그래서 if block을 통과하지 못하게 해서 중복 예약을 방지하는 것.
  function requestRenderIfNotRequested() {
    if (!renderRequested) {
      renderRequested = true;
      requestAnimationFrame(render);
    }
  }

  let currentVoxel = 0; // 새로운 복셀을 추가하기 위해 setVoxel을 호출할 때 넘겨줘서, 해당 복셀의 타일 이미지를 뭐로 지정할 지 결정해주는 값. 
  let currentId; // 현재 선택된 input의 id값을 저장해두는 값

  // type 속성값이 radio, name 속성값이 voxel인 모든 input 요소들을 가져온 뒤, 각각의 input 요소에 클릭 이벤트를 걸어놓음.
  document.querySelectorAll('#ui .tiles input[type=radio][name=voxel]').forEach((elem) => {
    elem.addEventListener('click', allowUncheck);
  });

  function allowUncheck() {
    // eventlistener 안에서 쓰면 this는 e.currentTarget, 즉 이벤트핸들러가 등록된 input 요소를 가리킴.
    if (this.id === currentId) {
      // 클릭이 발생한 input 요소의 id값이 currentId와 같다면, 현재 선택된 input이 중복 선택되었다는 뜻이므로, 선택을 해제시켜 둠.
      this.checked = false; // input 요소의 checked값을 해제하여 빨간 아웃라인을 지워주고
      currentId = undefined;
      currentVoxel = 0; // 두 변수값을 모두 초기화함.
    } else {
      // 만약 클릭이 발생한 input이 currentId와 다르다면, 새로운 input을 선택했다는 뜻이므로, 해당 input의 id값과 value값을 각각의 변수에 넣어줌.
      currentId = this.id;
      currentVoxel = parseInt(this.value); // this.value는 value="1" 이런 식으로 문자열로 저장되어 있으니까, 문자열을 정수로 파싱하는 parseInt 메서드를 이용해서 정수값으로 변환시킨 뒤 할당해 줌.
    }
  }

  // 이벤트 좌표값을 받아 캔버스의 상대적인 좌표값으로 변환해주는 함수
  function getCanvasRelativePosition(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * canvas.width / rect.width,
      y: (e.clientY - rect.top) * canvas.height / rect.height
    };
  }

  function placeVoxel(e) {
    // 클릭 후 pointerup 한 지점의 좌표값을 캔버스에 상대적인 좌표값으로 바꾼 뒤, 그것을 -1 ~ 1 사이의 정규화된 좌표값으로 변환함. 관련 내용은 picking-1 예제 참고
    const pos = getCanvasRelativePosition(e);
    const x = (pos.x / canvas.width) * 2 - 1;
    const y = (pos.y / canvas.height) * -2 + 1;

    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    start.setFromMatrixPosition(camera.matrixWorld); // 카메라의 전역 매트릭스값을 넘겨준 뒤, Vector3.setFromMatrixPosition()를 호출하면, 카메라의 전역 매트릭스값 중 위치값을 Vector3에 복사하여 지정함. 즉, end에는 카메라의 전역 위치값이 지정된 것.
    end.set(x, y, 1).unproject(camera); // Vector3.project() 메서드는 전역공간 좌표값 -> NDC 좌표값으로 변환해줬다면, .unproject(camera)는 정규화된 NDC 좌표값 -> 전역공간 좌표값으로 변환해 줌. 방향이 반대인거지. 즉, end에는 pointerup이 발생한 지점의 좌표값을 전역공간 좌표값이 지정된 것. 
    // 관련 내용은 html-to-3d-1 예제 참고.

    const intersection = world.intersectRay(start, end); // 카메라의 전역 위치값(start)와 pointerup 이벤트의 전역 위치값(end)를 전달해서 교차한 지점의 position, normal값이 묶인 객체를 리턴받음.

    // 교차하는 지점이 존재해서 null이 아닌 값을 리턴받았다면, if block으로 들어감.
    if (intersection) {
      // e.shiftKey는 이벤트가 발생했을 때 쉬프트키가 눌려있는 상태였는지 확인해 줌.
      // 이걸 왜 해주냐면, 쉬프트키를 누른 상태에서 복셀을 클릭하면 해당 복셀이 지워지고, 안 누른 상태에서 복셀을 클릭하면 해당 복셀 면 바로 옆에 새로운 복셀을 추가해 줌. 이 때, 추가된 복셀에는 현재 선택된 타일버튼(currentVoxel)에 해당하는 타일 부분을 텍스처로 씌워서 렌더해주려는 것.
      // 또한, 쉬프트키를 안 누른 상태에서도 0이 할당될 수 있음. 뭐냐면 allowUncheck() 함수에 의해 currentVoxel이 0으로 다시 초기화된 경우!
      const voxelId = e.shiftKey ? 0 : currentVoxel; // 쉬프트키가 눌렸다면 setVoxel 호출 시 0이 전달될거고, 안눌렸다면 setVoxel 호출 시 currentVoxel의 값이 전달되겠지? 형식화배열에 0이 지정된 복셀은 cell을 만드는 bufferGeometry에 해당 복셀좌표값으로 만든 데이터들을 추가해줄 수 없게 되어있음.

      // 교차점은 항상 면 위에 존재함. 즉, 면의 앞면에 위치하는지 뒷면에 위치하는지 정해져있지 않음.
      // 그래서 normal값에 0.5 또는 -0.5를 곱한 값을 더해줘서 교차점 좌표값이 앞면에 위치하게 할건지, 뒷면에 위치하게 할건지 정해줘야 함.
      // 왜 굳이 0.5 단위로 더해주냐면 복셀 하나의 크기가 1*1*1 사이즈니까 0.5, 즉 복셀의 면에서 앞면으로 0.5 또는 뒷면으로 0.5로 옮겨서 확실하게 면의 앞인지 뒤인지 구분시키려는 것.
      const pos = intersection.position.map((v, index) => {
        return v + intersection.normal[index] * (voxelId > 0 ? 0.5 : -0.5); // 0이면 복셀을 제거하려는 것이므로 0.5, 0보다 크면 복셀을 새롭게 추가하려는 것이므로 -0.5만큼 곱해준 뒤 position의 각 x, y, z에다가 더해줌.
      });
      world.setVoxel(...pos, voxelId); // 앞/뒷면까지 결정된 교차점 좌표값과 voxelId(0 또는 1~16사이의 값)을 전달하면서 setVoxel을 호출함. 해당 좌표값 지점의 복셀을 렌더해줄지 말지가 해당 복셀이 포함된 cell의 형식화배열에 할당되겠지.
      updateVoxelGeometry(...pos); // 사용자가 클릭한 지점에 새로운 복셀 지오메트리가 추가되었거나, 기존 복셀이 제거된 새로운 cell geometry를 업데이트 해주는 함수.
      requestRenderIfNotRequested(); // 새로운 cell geometry가 업데이트 되었으므로, 그것이 반영된 scene을 다시 렌더해서 화면에 출력하기 위해서 호출함.
    }
  }

  // 마우스 좌표값을 담아놓는 객체
  const mouse = {
    x: 0,
    y: 0,
  };

  // pointerdown 이벤트가 발생해서 클릭 또는 터치 이벤트가 발생하기 시작한 지점의 좌표값을 저장해두는 함수
  function recordStartPosition(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;

    // 마우스가 얼만큼 움직였는지, 그 거리를 계산하여 지정해주는 moveX,Y값을 0으로 초기화함. 왜? 이제 pointerdown한 뒤 움직이기 시작한 거니까
    mouse.moveX = 0;
    mouse.moveY = 0;
  }

  // pointerdown한 이후 pointerup으로 클릭 또는 터치 이벤트가 끝날때까지 마우스가 얼마만큼 이동했는지, 그 이동한 거리의 절댓값을 mouse.moveX,Y에 누적해서 더해주는 함수
  // 즉, 절댓값을 누산해주기 때문에, '방향'은 고려하지 않음. 예를 들어, X좌표값의 경우 왼쪽으로 10px 움직이나 오른쪽으로 10px 움직이나 mouse.moveX,Y에는 무조건 10을 더해주기만 함.
  function recordMovement(e) {
    mouse.moveX += Math.abs(mouse.x - e.clientX);
    mouse.moveY += Math.abs(mouse.y - e.clientY);
  }

  // 마우스 또는 터치 이벤트가 움직인 거리가 5px 이상이면 OrbitControls로 화면을 움직이기 위한 '드래그'로 간주하고, 그 이하면 '클릭'하여 복셀을 추가 또는 제거하려는 것으로 인식하는 함수
  function placeVoxelIfNoMovement(e) {
    // 마우스 또는 터치가 5px 미만으로 움직여야만 '클릭'으로 인식해서 클릭한 곳의 전역좌표값과 교차하는 지점에 복셀을 추가하거나 제거해주는 placeVoxel() 함수를 호출함.
    if (mouse.moveX < 5 && mouse.moveY < 5) {
      placeVoxel(e);
    }

    // pointerup 한 이후에는 마우스 또는 터치 이벤트가 끝난 것이므로, pointermove 및 pointerup 이벤트핸들러를 제거해버림. 하나의 클릭 이벤트가 끝났다면 클릭이 시작되었는지 인지하는 이벤트핸들러(pointerdown)만 남겨두고 나머지는 지워줘야 함.
    // 그래야 pointermove 또는 pointerup을 불필요하게 인지하여 오류가 나거나 메모리 누수를 방지할 수 있음.
    window.removeEventListener('pointermove', recordMovement);
    window.removeEventListener('pointerup', placeVoxelIfNoMovement);
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // 브라우저에서 정의된 기존 액션이 발생하는 것을 방지하기 위함.
    recordStartPosition(e);

    // 클릭 또는 터치 이벤트 시작(pointerdown)이 감지되는 순간 pointerdown 및 pointerup 이벤트핸들러도 등록해 줌.
    window.addEventListener('pointerdown', recordMovement);
    window.addEventListener('pointerup', placeVoxelIfNoMovement);
  }, {
    passive: false // true일 경우, preventDefault()를 호출하지 않음을 나타내는 값. 그니까 호출하려면 false로 지정해줘야 겠지
  });

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // 마찬가지로 브라우저에 정의된 기본 액션(scrolling)을 방지하기 위함.
  }, {
    passive: false
  });

  controls.addEventListener('change', requestRenderIfNotRequested);
  window.addEventListener('resize', requestRenderIfNotRequested); // OrbitControls의 움직임 또는 브라우저 resize가 발생할 때에만 다음 render 함수 호출을 예약할 수 있도록 함.
}

main();