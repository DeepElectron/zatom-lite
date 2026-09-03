import { assertEqual } from '../../testing/assert';
import { diffStructures } from '../structureDiff';

function testPureAddition() {
  // Supercell expansion: all prior atoms remain and the extra next atoms are added.
  const prior = [{ element: 'Na', position: [0,0,0] as [number,number,number] }];
  const next = [
    { element: 'Na', position: [0,0,0] as [number,number,number] },
    { element: 'Na', position: [5,0,0] as [number,number,number] },
  ];
  const d = diffStructures(prior, next);
  assertEqual(d.added.length, 1);
  assertEqual(d.removed.length, 0);
  assertEqual(d.unchangedCount, 1);
  assertEqual(d.added[0].position[0], 5);
}

function testRemoval() {
  const prior = [
    { element: 'O', position: [0,0,0] as [number,number,number] },
    { element: 'H', position: [1,0,0] as [number,number,number] },
  ];
  const next = [{ element: 'O', position: [0,0,0] as [number,number,number] }];
  const d = diffStructures(prior, next);
  assertEqual(d.removed.length, 1);
  assertEqual(d.removed[0].element, 'H');
  assertEqual(d.added.length, 0);
}

function testSubstitution() {
  // Substitution: an element change at one position removes the old atom and adds the new one.
  const prior = [{ element: 'O', position: [0,0,0] as [number,number,number] }];
  const next = [{ element: 'S', position: [0,0,0] as [number,number,number] }];
  const d = diffStructures(prior, next);
  assertEqual(d.added.length, 1);
  assertEqual(d.removed.length, 1);
  assertEqual(d.added[0].element, 'S');
  assertEqual(d.removed[0].element, 'O');
}

function testMoved() {
  const prior = [{ element: 'C', position: [0,0,0] as [number,number,number] }];
  const next = [{ element: 'C', position: [1,0,0] as [number,number,number] }];
  // A 1 Å displacement exceeds posTol=0.3, so the atoms do not match: added + removed.
  const d1 = diffStructures(prior, next);
  assertEqual(d1.added.length, 1);
  assertEqual(d1.removed.length, 1);
  // A larger tolerance classifies it as moved.
  const d2 = diffStructures(prior, next, { posTol: 2, moveTol: 0.3 });
  assertEqual(d2.moved.length, 1);
  assertEqual(d2.added.length, 0);
  assertEqual(d2.removed.length, 0);
}

function testNoChange() {
  const a = [{ element: 'Fe', position: [1,2,3] as [number,number,number] }];
  const d = diffStructures(a, a.map(x => ({...x})));
  assertEqual(d.added.length, 0);
  assertEqual(d.removed.length, 0);
  assertEqual(d.unchangedCount, 1);
  assertEqual(d.changedRegion, null);
}

function run() {
  testPureAddition();
  testRemoval();
  testSubstitution();
  testMoved();
  testNoChange();
  console.log('structureDiff tests passed');
}
run();
