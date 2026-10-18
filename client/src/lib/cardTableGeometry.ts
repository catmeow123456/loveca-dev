/**
 * Planar rotation inherited from card wrappers, excluding the element itself.
 * Table wrappers use translations, scaling and Z rotation; composing their
 * matrices also preserves the order of nested CSS rotate/transform properties.
 */
export function getAncestorTableRotation(element: HTMLElement): number {
  let matrix = new DOMMatrix();
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    const rotation = Number.parseFloat(style.rotate) || 0;
    let local = new DOMMatrix().rotate(0, 0, rotation);
    if (style.transform !== 'none') local = local.multiply(new DOMMatrix(style.transform));
    matrix = local.multiply(matrix);
  }
  return (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
}
