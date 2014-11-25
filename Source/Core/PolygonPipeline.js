/*global define*/
define([
        './Cartesian2',
        './Cartesian3',
        './ComponentDatatype',
        './defaultValue',
        './defined',
        './DeveloperError',
        './Ellipsoid',
        './EllipsoidTangentPlane',
        './Geometry',
        './GeometryAttribute',
        './Math',
        './pointInsideTriangle',
        './PrimitiveType',
        './Queue',
        './WindingOrder'
    ], function(
        Cartesian2,
        Cartesian3,
        ComponentDatatype,
        defaultValue,
        defined,
        DeveloperError,
        Ellipsoid,
        EllipsoidTangentPlane,
        Geometry,
        GeometryAttribute,
        CesiumMath,
        pointInsideTriangle,
        PrimitiveType,
        Queue,
        WindingOrder) {
    "use strict";

    var uScratch = new Cartesian2();
    var vScratch = new Cartesian2();
    function isTipConvex(p0, p1, p2) {
        var u = Cartesian2.subtract(p1, p0, uScratch);
        var v = Cartesian2.subtract(p2, p1, vScratch);

        // Use the sign of the z component of the cross product
        return ((u.x * v.y) - (u.y * v.x)) >= 0.0;
    }

    /**
     * Returns the index of the vertex with the maximum X value.
     *
     * @param {Cartesian2[]} positions An array of the Cartesian points defining the polygon's vertices.
     * @returns {Number} The index of the positions with the maximum X value.
     *
     * @private
     */
    function getRightmostPositionIndex(positions) {
        var maximumX = positions[0].x;
        var rightmostPositionIndex = 0;
        for ( var i = 0; i < positions.length; i++) {
            if (positions[i].x > maximumX) {
                maximumX = positions[i].x;
                rightmostPositionIndex = i;
            }
        }
        return rightmostPositionIndex;
    }

    /**
     * Returns the index of the ring that contains the rightmost vertex.
     *
     * @param {Cartesian2[]} rings An array of arrays of Cartesians. Each array contains the vertices defining a polygon.
     * @returns {Number} The index of the ring containing the rightmost vertex.
     *
     * @private
     */
    function getRightmostRingIndex(rings) {
        var rightmostX = rings[0][0].x;
        var rightmostRingIndex = 0;
        for ( var ring = 0; ring < rings.length; ring++) {
            var maximumX = rings[ring][getRightmostPositionIndex(rings[ring])].x;
            if (maximumX > rightmostX) {
                rightmostX = maximumX;
                rightmostRingIndex = ring;
            }
        }

        return rightmostRingIndex;
    }

    /**
     * Returns a list containing the reflex vertices for a given polygon.
     *
     * @param {Cartesian2[]} polygon An array of Cartesian elements defining the polygon.
     * @returns {Cartesian2[]}
     *
     * @private
     */
    function getReflexVertices(polygon) {
        var reflexVertices = [];
        for ( var i = 0; i < polygon.length; i++) {
            var p0 = polygon[((i - 1) + polygon.length) % polygon.length];
            var p1 = polygon[i];
            var p2 = polygon[(i + 1) % polygon.length];

            if (!isTipConvex(p0, p1, p2)) {
                reflexVertices.push(p1);
            }
        }
        return reflexVertices;
    }

    /**
     * Returns true if the given point is contained in the list of positions.
     *
     * @param {Cartesian2[]} positions A list of Cartesian elements defining a polygon.
     * @param {Cartesian2} point The point to check.
     * @returns {Number} The index of <code>point</code> in <code>positions</code> or -1 if it was not found.
     *
     * @private
     */
    function isVertex(positions, point) {
        for ( var i = 0; i < positions.length; i++) {
            if (Cartesian2.equals(point, positions[i])) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Given a point inside a polygon, find the nearest point directly to the right that lies on one of the polygon's edges.
     *
     * @param {Cartesian2} point A point inside the polygon defined by <code>ring</code>.
     * @param {Cartesian2[]} ring A list of Cartesian points defining a polygon.
     * @param {Number[]} [edgeIndices]  An array containing the indices two endpoints of the edge containing the intersection.
     * @returns {Cartesian2} The intersection point.
     *
     * @private
     */
    var distScratch = new Cartesian2();
    function intersectPointWithRing(point, ring, edgeIndices) {
        edgeIndices = defaultValue(edgeIndices, []);

        var minDistance = Number.MAX_VALUE;
        var rightmostVertexIndex = getRightmostPositionIndex(ring);
        var intersection = new Cartesian2(ring[rightmostVertexIndex].x, point.y);
        edgeIndices.push(rightmostVertexIndex);
        edgeIndices.push((rightmostVertexIndex + 1) % ring.length);

        var boundaryMinX = ring[0].x;
        var boundaryMaxX = boundaryMinX;
        for ( var i = 1; i < ring.length; ++i) {
            if (ring[i].x < boundaryMinX) {
                boundaryMinX = ring[i].x;
            } else if (ring[i].x > boundaryMaxX) {
                boundaryMaxX = ring[i].x;
            }
        }
        boundaryMaxX += (boundaryMaxX - boundaryMinX);
        var point2 = new Cartesian3(boundaryMaxX, point.y, 0.0);

        // Find the nearest intersection.
        for (i = 0; i < ring.length; i++) {
            var v1 = ring[i];
            var v2 = ring[(i + 1) % ring.length];

            if (((v1.x >= point.x) || (v2.x >= point.x)) && (((v1.y >= point.y) && (v2.y <= point.y)) || ((v1.y <= point.y) && (v2.y >= point.y)))) {
                var temp = ((v2.y - v1.y) * (point2.x - point.x)) - ((v2.x - v1.x) * (point2.y - point.y));
                if (temp !== 0.0) {
                    temp = 1.0 / temp;
                    var ua = (((v2.x - v1.x) * (point.y - v1.y)) - ((v2.y - v1.y) * (point.x - v1.x))) * temp;
                    var ub = (((point2.x - point.x) * (point.y - v1.y)) - ((point2.y - point.y) * (point.x - v1.x))) * temp;
                    if ((ua >= 0.0) && (ua <= 1.0) && (ub >= 0.0) && (ub <= 1.0)) {
                        var tempIntersection = new Cartesian2(point.x + ua * (point2.x - point.x), point.y + ua * (point2.y - point.y));
                        var dist = Cartesian2.subtract(tempIntersection, point, distScratch);
                        temp = Cartesian2.magnitudeSquared(dist);
                        if (temp < minDistance) {
                            intersection = tempIntersection;
                            minDistance = temp;
                            edgeIndices[0] = i;
                            edgeIndices[1] = (i + 1) % ring.length;
                        }
                    }
                }
            }
        }

        return intersection;
    }

    /**
     * Given an outer ring and multiple inner rings, determine the point on the outer ring that is visible
     * to the rightmost vertex of the rightmost inner ring.
     *
     * @param {Cartesian2[]} outerRing An array of Cartesian points defining the outer boundary of the polygon.
     * @param {Cartesian2[]} innerRings An array of arrays of Cartesian points, where each array represents a hole in the polygon.
     * @returns {Number} The index of the vertex in <code>outerRing</code> that is mutually visible to the rightmost vertex in <code>inenrRing</code>.
     *
     * @private
     */
    var v1Scratch = new Cartesian2(1.0, 0.0);
    var v2Scratch = new Cartesian2();
    function getMutuallyVisibleVertexIndex(outerRing, innerRings) {
        var innerRingIndex = getRightmostRingIndex(innerRings);
        var innerRing = innerRings[innerRingIndex];
        var innerRingVertexIndex = getRightmostPositionIndex(innerRing);
        var innerRingVertex = innerRing[innerRingVertexIndex];
        var edgeIndices = [];
        var intersection = intersectPointWithRing(innerRingVertex, outerRing, edgeIndices);

        var visibleVertex = isVertex(outerRing, intersection);
        if (visibleVertex !== -1) {
            return visibleVertex;
        }

        // Set P to be the edge endpoint closest to the inner ring vertex
        var d1 = Cartesian2.magnitudeSquared(Cartesian2.subtract(outerRing[edgeIndices[0]], innerRingVertex, v1Scratch));
        var d2 = Cartesian2.magnitudeSquared(Cartesian2.subtract(outerRing[edgeIndices[1]], innerRingVertex, v1Scratch));
        var p = (d1 < d2) ? outerRing[edgeIndices[0]] : outerRing[edgeIndices[1]];

        var reflexVertices = getReflexVertices(outerRing);
        var reflexIndex = reflexVertices.indexOf(p);
        if (reflexIndex !== -1) {
            reflexVertices.splice(reflexIndex, 1); // Do not include p if it happens to be reflex.
        }

        var pointsInside = [];
        for ( var i = 0; i < reflexVertices.length; i++) {
            var vertex = reflexVertices[i];
            if (pointInsideTriangle(vertex, innerRingVertex, intersection, p)) {
                pointsInside.push(vertex);
            }
        }

        // If all reflexive vertices are outside the triangle formed by points
        // innerRingVertex, intersection and P, then P is the visible vertex.
        // Otherwise, return the reflex vertex that minimizes the angle between <1,0> and <k, reflex>.
        var minAngle = Number.MAX_VALUE;
        if (pointsInside.length > 0) {
            var v1 = Cartesian2.fromElements(1.0, 0.0, v1Scratch);
            for (i = 0; i < pointsInside.length; i++) {
                var v2 = Cartesian2.subtract(pointsInside[i], innerRingVertex, v2Scratch);
                var denominator = Cartesian2.magnitude(v1) * Cartesian2.magnitudeSquared(v2);
                if (denominator !== 0) {
                    var angle = Math.abs(CesiumMath.acosClamped(Cartesian2.dot(v1, v2) / denominator));
                    if (angle < minAngle) {
                        minAngle = angle;
                        p = pointsInside[i];
                    }
                }
            }
        }

        return outerRing.indexOf(p);
    }

    /**
     * Given a polygon defined by an outer ring with one or more inner rings (holes), return a single list of points representing
     * a polygon with the rightmost hole added to it. The added hole is removed from <code>innerRings</code>.
     *
     * @param {Cartesian2[]} outerRing An array of Cartesian points defining the outer boundary of the polygon.
     * @param {Cartesian2[]} innerRings An array of arrays of Cartesian points, where each array represents a hole in the polygon.
     * @returns {Cartesian2[]} A single list of Cartesian points defining the polygon, including the eliminated inner ring.
     *
     * @private
     */
    function eliminateHole(outerRing, innerRings, ellipsoid) {
        // Check that the holes are defined in the winding order opposite that of the outer ring.
        var windingOrder = PolygonPipeline.computeWindingOrder2D(outerRing);
        for ( var i = 0; i < innerRings.length; i++) {
            var ring = innerRings[i];

            // Ensure each hole's first and last points are the same.
            if (!Cartesian3.equals(ring[0], ring[ring.length - 1])) {
                ring.push(ring[0]);
            }

            var innerWindingOrder = PolygonPipeline.computeWindingOrder2D(ring);
            if (innerWindingOrder === windingOrder) {
                ring.reverse();
            }
        }

        // Project points onto a tangent plane to find the mutually visible vertex.
        var tangentPlane = EllipsoidTangentPlane.fromPoints(outerRing, ellipsoid);
        var tangentOuterRing = tangentPlane.projectPointsOntoPlane(outerRing);
        var tangentInnerRings = [];
        for (i = 0; i < innerRings.length; i++) {
            tangentInnerRings.push(tangentPlane.projectPointsOntoPlane(innerRings[i]));
        }

        var visibleVertexIndex = getMutuallyVisibleVertexIndex(tangentOuterRing, tangentInnerRings);
        var innerRingIndex = getRightmostRingIndex(tangentInnerRings);
        var innerRingVertexIndex = getRightmostPositionIndex(tangentInnerRings[innerRingIndex]);

        var innerRing = innerRings[innerRingIndex];
        var newPolygonVertices = [];

        for (i = 0; i < outerRing.length; i++) {
            newPolygonVertices.push(outerRing[i]);
        }

        var j;
        var holeVerticesToAdd = [];

        // If the rightmost inner vertex is not the starting and ending point of the ring,
        // then some other point is duplicated in the inner ring and should be skipped once.
        if (innerRingVertexIndex !== 0) {
            for (j = 0; j <= innerRing.length; j++) {
                var index = (j + innerRingVertexIndex) % innerRing.length;
                if (index !== 0) {
                    holeVerticesToAdd.push(innerRing[index]);
                }
            }
        } else {
            for (j = 0; j < innerRing.length; j++) {
                holeVerticesToAdd.push(innerRing[(j + innerRingVertexIndex) % innerRing.length]);
            }
        }

        var lastVisibleVertexIndex = newPolygonVertices.lastIndexOf(outerRing[visibleVertexIndex]);

        holeVerticesToAdd.push(outerRing[lastVisibleVertexIndex]);

        var front = newPolygonVertices.slice(0, lastVisibleVertexIndex + 1);
        var back = newPolygonVertices.slice(lastVisibleVertexIndex + 1);
        newPolygonVertices = front.concat(holeVerticesToAdd, back);

        innerRings.splice(innerRingIndex, 1);

        return newPolygonVertices;
    }

    /**
     * Use seeded pseudo-random number to be testable.
     *
     * @param {Number} length
     * @returns {Number} Random integer from 0 to <code>length - 1</code>
     *
     * @private
     */
    function getRandomIndex(length) {
        var random = '0.' + Math.sin(rseed).toString().substr(5);
        rseed += 0.2;
        var i = Math.floor(random * length);
        if (i === length) {
            i--;
        }
        return i;
    }
    var rseed = 0;

    var INTERNAL = -1;
    var EXTERNAL = -2;

    var CLEAN_CUT = -1;
    var INVALID_CUT = -2;

    /**
     * Determine whether a cut between two polygon vertices is clean.
     *
     * @param {Number} a1i Index of first vertex.
     * @param {Number} a2i Index of second vertex.
     * @param {Array} pArray Array of <code>{ position, index }</code> objects representing the polygon.
     * @returns {Number} If CLEAN_CUT, a cut from the first vertex to the second is internal and does not cross any other sides.
     * If INVALID_CUT, then the vertices were valid but a cut could not be made. If the value is greater than or equal to zero,
     * then the value is the index of an invalid vertex.
     *
     * @private
     */
    function cleanCut(a1i, a2i, pArray) {
        var internalCut12 = internalCut(a1i, a2i, pArray);
        if (internalCut12 >= 0) {
            return internalCut12;
        }

        var internalCut21 = internalCut(a2i, a1i, pArray);
        if (internalCut21 >= 0) {
            return internalCut21;
        }

        if (internalCut12 === INTERNAL && internalCut21 === INTERNAL &&
                !intersectsSide(pArray[a1i].position, pArray[a2i].position, pArray) &&
                !Cartesian2.equals(pArray[a1i].position, pArray[a2i].position)) {
            return CLEAN_CUT;
        }

        return INVALID_CUT;
    }

    /**
     * Determine whether the cut formed between the two vertices is internal
     * to the angle formed by the sides connecting at the first vertex.
     *
     * @param {Number} a1i Index of first vertex.
     * @param {Number} a2i Index of second vertex.
     * @param {Array} pArray Array of <code>{ position, index }</code> objects representing the polygon.
     * @returns {Number} If INTERNAL, the cut formed between the two vertices is internal to the angle at vertex 1.
     * If EXTERNAL, then the cut formed between the two vertices is external to the angle at vertex 1. If the value
     * is greater than or equal to zero, then the value is the index of an invalid vertex.
     *
     * @private
     */
    var s1Scratch = new Cartesian3();
    var s2Scratch = new Cartesian3();
    var cutScratch = new Cartesian3();
    function internalCut(a1i, a2i, pArray) {
        // Make sure vertex is valid
        if (!validateVertex(a1i, pArray)) {
            return a1i;
        }

        // Get the nodes from the array
        var a1Position = pArray[a1i].position;
        var a2Position = pArray[a2i].position;
        var length = pArray.length;

        // Define side and cut vectors
        var before = CesiumMath.mod(a1i - 1, length);
        if (!validateVertex(before, pArray)) {
            return before;
        }

        var after = CesiumMath.mod(a1i + 1, length);
        if (!validateVertex(after, pArray)) {
            return after;
        }


        var s1 = Cartesian2.subtract(pArray[before].position, a1Position, s1Scratch);
        var s2 = Cartesian2.subtract(pArray[after].position, a1Position, s2Scratch);
        var cut = Cartesian2.subtract(a2Position, a1Position, cutScratch);

        var leftEdgeCutZ = crossZ(s1, cut);
        var rightEdgeCutZ = crossZ(s2, cut);

        if (leftEdgeCutZ === 0.0) { // cut is parallel to (a1i - 1, a1i) edge
            return isInternalToParallelSide(s1, cut) ? INTERNAL : EXTERNAL;
        } else if (rightEdgeCutZ === 0.0) { // cut is parallel to (a1i + 1, a1i) edge
            return isInternalToParallelSide(s2, cut) ? INTERNAL : EXTERNAL;
        } else {
            var z = crossZ(s1, s2);
            if (z < 0.0) { // angle at a1i is less than 180 degrees
                return leftEdgeCutZ < 0.0 && rightEdgeCutZ > 0.0 ? INTERNAL : EXTERNAL; // Cut is in-between sides
            } else if (z > 0.0) { // angle at a1i is greater than 180 degrees
                return leftEdgeCutZ > 0.0 && rightEdgeCutZ < 0.0 ? EXTERNAL : INTERNAL; // Cut is in-between sides
            }
        }
    }

    /**
     * Checks whether cut parallel to side is internal.
     *
     *  e.g.
     *
     *  7_________6
     *  |         |
     *  | 4 ______|
     *  |  |       5
     *  |  |______2     Is cut from 1 to 6 internal? No.
     *  | 3       |
     *  |_________|
     * 0           1
     *
     * Note that this function simply checks whether the cut is longer or shorter.
     *
     * An important valid cut:
     *
     * Polygon:
     *
     * 0 ___2__4
     *  |  /\  |
     *  | /  \ |   Is cut 0 to 2 or 2 to 4 internal? Yes.
     *  |/    \|
     * 1       3
     *
     * This situation can occur and the only solution is a cut along a parallel
     * side.
     *
     * This method is technically incomplete, however, for the following case:
     *
     *  7_________6
     *  |         |
     *  |         |______4
     *  |          5     |    Now is 1 to 6 internal? Yes, but we'll never need it.
     *  |         2______|
     *  |         |      5
     *  |_________|
     * 0           1
     *
     * In this case, although the cut from 1 to 6 is valid, the side 1-2 is
     * shorter and thus this cut will be called invalid. Assuming there are no
     * superfluous vertices (a requirement for this method to work), however,
     * we'll never need this cut because we can always find cut 2-5 as a substitute.
     *
     * @param {Cartesian2} side
     * @param {Cartesian2} cut
     * @returns {Boolean}
     *
     * @private
     */
    function isInternalToParallelSide(side, cut) {
        return Cartesian2.magnitude(cut) < Cartesian2.magnitude(side);
    }

    /**
     * Checks to make sure vertex is not superfluous.
     *
     * @param {Number} index Index of vertex.
     * @param {Number} pArray Array of vertices.
     *
     * @exception {DeveloperError} Superfluous vertex found.
     *
     * @private
     */
    function validateVertex(index, pArray) {
        var length = pArray.length;
        var before = CesiumMath.mod(index - 1, length);
        var after = CesiumMath.mod(index + 1, length);

        // check if adjacent edges are parallel
        if (indexedEdgeCrossZ(before, after, index, pArray) === 0.0) {
            return false;
        }

        return true;
    }

    function indexedEdgeCrossZ(p0Index, p1Index, vertexIndex, array) {
        var p0 = array[p0Index].position;
        var p1 = array[p1Index].position;
        var v = array[vertexIndex].position;

        var vx = v.x;
        var vy = v.y;

        // (p0 - v).cross(p1 - v).z
        var leftX = p0.x - vx;
        var leftY = p0.y - vy;
        var rightX = p1.x - vx;
        var rightY = p1.y - vy;

        return leftX * rightY - leftY * rightX;
    }

    function crossZ(p0, p1) {
        // p0.cross(p1).z
        return p0.x * p1.y - p0.y * p1.x;
    }

    /**
     * Determine whether this segment intersects any other polygon sides.
     *
     * @param {Cartesian2} a1 Position of first vertex.
     * @param {Cartesian2} a2 Position of second vertex.
     * @param {Array} pArray Array of <code>{ position, index }</code> objects representing polygon.
     * @returns {Boolean} The segment between a1 and a2 intersect another polygon side.
     *
     * @private
     */
    var intersectionScratch = new Cartesian2();
    function intersectsSide(a1, a2, pArray) {
        for ( var i = 0; i < pArray.length; i++) {
            var b1 = pArray[i].position;
            var b2;
            if (i < pArray.length - 1) {
                b2 = pArray[i + 1].position;
            } else {
                b2 = pArray[0].position;
            }

            // If there's a duplicate point, there's no intersection here.
            if (Cartesian2.equals(a1, b1) || Cartesian2.equals(a2, b2) || Cartesian2.equals(a1, b2) || Cartesian2.equals(a2, b1)) {
                continue;
            }

            // Slopes (NaN means vertical)
            var slopeA = (a2.y - a1.y) / (a2.x - a1.x);
            var slopeB = (b2.y - b1.y) / (b2.x - b1.x);

            // If parallel, no intersection
            if (slopeA === slopeB || (isNaN(slopeA) && isNaN(slopeB))) {
                continue;
            }

            // Calculate intersection point
            var intX;
            if (isNaN(slopeA)) {
                intX = a1.x;
            } else if (isNaN(slopeB)) {
                intX = b1.x;
            } else {
                intX = (a1.y - b1.y - slopeA * a1.x + slopeB * b1.x) / (slopeB - slopeA);
            }
            var intY = slopeA * intX + a1.y - slopeA * a1.x;

            var intersection = Cartesian2.fromElements(intX, intY, intersectionScratch);

            // If intersection is on an endpoint, count no intersection
            if (Cartesian2.equals(intersection, a1) || Cartesian2.equals(intersection, a2) || Cartesian2.equals(intersection, b1) || Cartesian2.equals(intersection, b2)) {
                continue;
            }

            // Is intersection point between segments?
            var intersects = isBetween(intX, a1.x, a2.x) && isBetween(intY, a1.y, a2.y) && isBetween(intX, b1.x, b2.x) && isBetween(intY, b1.y, b2.y);

            // If intersecting, the cut is not clean
            if (intersects) {
                return true;
            }
        }
        return false;
    }

    function triangleInLine(pArray) {
        // Get two sides. If they're parallel, so is the last.
        return indexedEdgeCrossZ(1, 2, 0, pArray) === 0.0;
    }

    /**
     * Determine whether number is between n1 and n2.
     * Do not include number === n1 or number === n2.
     * Do include n1 === n2 === number.
     *
     * @param {Number} number The number tested.
     * @param {Number} n1 First bound.
     * @param {Number} n2 Secound bound.
     * @returns {Boolean} number is between n1 and n2.
     *
     * @private
     */
    function isBetween(number, n1, n2) {
        return ((number > n1 || number > n2) && (number < n1 || number < n2)) || (n1 === n2 && n1 === number);
    }

    /**
     * This recursive algorithm takes a polygon, randomly selects two vertices
     * which form a clean cut through the polygon, and divides the polygon
     * then continues to "chop" the two resulting polygons.
     *
     * @param {Array} nodeArray Array of <code>{ position, index }</code> objects representing polygon
     * @returns {Number[]} Index array representing triangles that fill the polygon
     *
     * @exception {DeveloperError} Invalid polygon: must have at least three vertices.
     *
     * @private
     */
    function randomChop(nodeArray) {
        // Determine & verify number of vertices
        var numVertices = nodeArray.length;

        // Is it already a triangle?
        if (numVertices === 3) {
            // Only return triangle if it has area (not a line)
            if (!triangleInLine(nodeArray)) {
                return [nodeArray[0].index, nodeArray[1].index, nodeArray[2].index];
            }

            // If it's a line, we don't need it.
            return [];
        } else if (nodeArray.length < 3) {
            throw new DeveloperError('Invalid polygon: must have at least three vertices.');
        }

        // Search for clean cut
        var tries = 0;
        var maxTries = nodeArray.length * 10;

        var cutResult = INVALID_CUT;
        var index1;
        var index2;

        while (cutResult < CLEAN_CUT && tries++ < maxTries) {
            // Generate random indices
            index1 = getRandomIndex(nodeArray.length);
            index2 = index1 + 1;
            while (Math.abs(index1 - index2) < 2 || Math.abs(index1 - index2) > nodeArray.length - 2) {
                index2 = getRandomIndex(nodeArray.length);
            }

            // Make sure index2 is bigger
            if (index1 > index2) {
                var index = index1;
                index1 = index2;
                index2 = index;
            }

            cutResult = cleanCut(index1, index2, nodeArray);
        }

        if (cutResult === CLEAN_CUT) {
            // Divide polygon
            var nodeArray2 = nodeArray.splice(index1, (index2 - index1 + 1), nodeArray[index1], nodeArray[index2]);

            // Chop up resulting polygons
            return randomChop(nodeArray).concat(randomChop(nodeArray2));
        } else if (cutResult >= 0) {
            // Eliminate superfluous vertex and start over
            nodeArray.splice(cutResult, 1);
            return randomChop(nodeArray);
        }

        // No clean cut could be found
        return [];
    }

    var scaleToGeodeticHeightN = new Cartesian3();
    var scaleToGeodeticHeightP = new Cartesian3();

    /**
     * @private
     */
    var PolygonPipeline = {};
    /**
     * Cleans up a simple polygon by removing duplicate adjacent positions and making
     * the first position not equal the last position.
     *
     * @exception {DeveloperError} At least three positions are required.
     */
    PolygonPipeline.removeDuplicates = function(positions) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(positions)) {
            throw new DeveloperError('positions is required.');
        }
        if (positions.length < 3) {
            throw new DeveloperError('At least three positions are required.');
        }
        //>>includeEnd('debug');

        var length = positions.length;

        var cleanedPositions = [];

        for ( var i0 = length - 1, i1 = 0; i1 < length; i0 = i1++) {
            var v0 = positions[i0];
            var v1 = positions[i1];

            if (!Cartesian3.equals(v0, v1)) {
                cleanedPositions.push(v1); // Shallow copy!
            }
        }

        return cleanedPositions;
    };

    /**
     * @exception {DeveloperError} At least three positions are required.
     */
    PolygonPipeline.computeArea2D = function(positions) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(positions)) {
            throw new DeveloperError('positions is required.');
        }
        if (positions.length < 3) {
            throw new DeveloperError('At least three positions are required.');
        }
        //>>includeEnd('debug');

        var length = positions.length;
        var area = 0.0;

        for ( var i0 = length - 1, i1 = 0; i1 < length; i0 = i1++) {
            var v0 = positions[i0];
            var v1 = positions[i1];

            area += (v0.x * v1.y) - (v1.x * v0.y);
        }

        return area * 0.5;
    };

    /**
     * @returns {WindingOrder} The winding order.
     *
     * @exception {DeveloperError} At least three positions are required.
     */
    PolygonPipeline.computeWindingOrder2D = function(positions) {
        var area = PolygonPipeline.computeArea2D(positions);
        return (area > 0.0) ? WindingOrder.COUNTER_CLOCKWISE : WindingOrder.CLOCKWISE;
    };

    /**
     * Triangulate a polygon
     *
     * @param {Cartesian2[]} positions - Cartesian2 array containing the vertices of the polygon
     * @returns {Number[]} - Index array representing triangles that fill the polygon
     *
     * @exception {DeveloperError} At least three positions are required.
     */
    PolygonPipeline.triangulate = function(positions) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(positions)) {
            throw new DeveloperError('positions is required.');
        }
        if (positions.length < 3) {
            throw new DeveloperError('At least three positions are required.');
        }
        //>>includeEnd('debug');

        var length = positions.length;
        // Keep track of indices for later
        var nodeArray = [];
        for ( var i = 0; i < length; ++i) {
            nodeArray[i] = {
                position : positions[i],
                index : i
            };
        }

        // Recursive chop
        return randomChop(nodeArray);
    };

    /**
     * This function is used for predictable testing.
     *
     * @private
     */
    PolygonPipeline.resetSeed = function(seed) {
        rseed = defaultValue(seed, 0);
    };

    /**
     * Subdivides positions and raises points to the surface of the ellipsoid.
     *
     * @param {Cartesian3[]} positions An array of {@link Cartesian3} positions of the polygon.
     * @param {Number[]} indices An array of indices that determines the triangles in the polygon.
     * @param {Number} [granularity=CesiumMath.RADIANS_PER_DEGREE] The distance, in radians, between each latitude and longitude. Determines the number of positions in the buffer.
     *
     * @exception {DeveloperError} At least three indices are required.
     * @exception {DeveloperError} The number of indices must be divisable by three.
     * @exception {DeveloperError} Granularity must be greater than zero.
     */
    PolygonPipeline.computeSubdivision = function(positions, indices, granularity) {
        granularity = defaultValue(granularity, CesiumMath.RADIANS_PER_DEGREE);

        //>>includeStart('debug', pragmas.debug);
        if (!defined(positions)) {
            throw new DeveloperError('positions is required.');
        }
        if (!defined(indices)) {
            throw new DeveloperError('indices is required.');
        }
        if (indices.length < 3) {
            throw new DeveloperError('At least three indices are required.');
        }
        if (indices.length % 3 !== 0) {
            throw new DeveloperError('The number of indices must be divisable by three.');
        }
        if (granularity <= 0.0) {
            throw new DeveloperError('granularity must be greater than zero.');
        }
        //>>includeEnd('debug');

        // Use a queue for triangles that need (or might need) to be subdivided.
        var triangles = new Queue();

        var indicesLength = indices.length;
        for ( var j = 0; j < indicesLength; j += 3) {
            triangles.enqueue({
                i0 : indices[j],
                i1 : indices[j + 1],
                i2 : indices[j + 2]
            });
        }

        // New positions due to edge splits are appended to the positions list.
        var subdividedPositions = positions.slice(0); // shallow copy!
        var subdividedIndices = [];

        // Used to make sure shared edges are not split more than once.
        var edges = {};

        var i;
        while (triangles.length > 0) {
            var triangle = triangles.dequeue();

            var v0 = subdividedPositions[triangle.i0];
            var v1 = subdividedPositions[triangle.i1];
            var v2 = subdividedPositions[triangle.i2];

            var g0 = Cartesian3.angleBetween(v0, v1);
            var g1 = Cartesian3.angleBetween(v1, v2);
            var g2 = Cartesian3.angleBetween(v2, v0);

            var max = Math.max(g0, Math.max(g1, g2));
            var edge;
            var mid;

            if (max > granularity) {
                if (g0 === max) {
                    edge = Math.min(triangle.i0, triangle.i1).toString() + ' ' + Math.max(triangle.i0, triangle.i1).toString();

                    i = edges[edge];
                    if (!i) {
                        mid = Cartesian3.add(v0, v1, new Cartesian3());
                        Cartesian3.multiplyByScalar(mid, 0.5, mid);
                        subdividedPositions.push(mid);
                        i = subdividedPositions.length - 1;
                        edges[edge] = i;
                    }

                    triangles.enqueue({
                        i0 : triangle.i0,
                        i1 : i,
                        i2 : triangle.i2
                    });
                    triangles.enqueue({
                        i0 : i,
                        i1 : triangle.i1,
                        i2 : triangle.i2
                    });
                } else if (g1 === max) {
                    edge = Math.min(triangle.i1, triangle.i2).toString() + ' ' + Math.max(triangle.i1, triangle.i2).toString();

                    i = edges[edge];
                    if (!i) {
                        mid = Cartesian3.add(v1, v2, new Cartesian3());
                        Cartesian3.multiplyByScalar(mid, 0.5, mid);
                        subdividedPositions.push(mid);
                        i = subdividedPositions.length - 1;
                        edges[edge] = i;
                    }

                    triangles.enqueue({
                        i0 : triangle.i1,
                        i1 : i,
                        i2 : triangle.i0
                    });
                    triangles.enqueue({
                        i0 : i,
                        i1 : triangle.i2,
                        i2 : triangle.i0
                    });
                } else if (g2 === max) {
                    edge = Math.min(triangle.i2, triangle.i0).toString() + ' ' + Math.max(triangle.i2, triangle.i0).toString();

                    i = edges[edge];
                    if (!i) {
                        mid = Cartesian3.add(v2, v0, new Cartesian3());
                        Cartesian3.multiplyByScalar(mid, 0.5, mid);
                        subdividedPositions.push(mid);
                        i = subdividedPositions.length - 1;
                        edges[edge] = i;
                    }

                    triangles.enqueue({
                        i0 : triangle.i2,
                        i1 : i,
                        i2 : triangle.i1
                    });
                    triangles.enqueue({
                        i0 : i,
                        i1 : triangle.i0,
                        i2 : triangle.i1
                    });
                }
            } else {
                subdividedIndices.push(triangle.i0);
                subdividedIndices.push(triangle.i1);
                subdividedIndices.push(triangle.i2);
            }
        }

        // PERFORMANCE_IDEA Rather that waste time re-iterating the entire set of positions
        // here, all of the above code can be refactored to flatten as values are added
        // Removing the need for this for loop.
        var length = subdividedPositions.length;
        var flattenedPositions = new Array(length * 3);
        var q = 0;
        for (i = 0; i < length; i++) {
            var item = subdividedPositions[i];
            flattenedPositions[q++] = item.x;
            flattenedPositions[q++] = item.y;
            flattenedPositions[q++] = item.z;
        }

        return new Geometry({
            attributes : {
                position : new GeometryAttribute({
                    componentDatatype : ComponentDatatype.DOUBLE,
                    componentsPerAttribute : 3,
                    values : flattenedPositions
                })
            },
            indices : subdividedIndices,
            primitiveType : PrimitiveType.TRIANGLES
        });
    };

    /**
     * Scales each position of a geometry's position attribute to a height, in place.
     *
     * @param {Geometry} geometry The geometry whose positions are to be scaled.
     * @param {Number} [height=0.0] The desired height to add to the positions of the geometry.
     * @param {Ellipsoid} [ellipsoid=Ellipsoid.WGS84] The ellipsoid on which the positions lie.
     * @param {Boolean} [scaleToSurface=true] <code>true</code> if the positions need to be scaled to the surface before the height is added.
     * @returns {Geometry} The same geometry whose positions where scaled.
     */
    PolygonPipeline.scaleToGeodeticHeight = function(geometry, height, ellipsoid, scaleToSurface) {
        ellipsoid = defaultValue(ellipsoid, Ellipsoid.WGS84);

        var n = scaleToGeodeticHeightN;
        var p = scaleToGeodeticHeightP;

        height = defaultValue(height, 0.0);
        scaleToSurface = defaultValue(scaleToSurface, true);

        if (defined(geometry) && defined(geometry.attributes) && defined(geometry.attributes.position)) {
            var positions = geometry.attributes.position.values;
            var length = positions.length;

            for ( var i = 0; i < length; i += 3) {
                Cartesian3.fromArray(positions, i, p);

                if (scaleToSurface) {
                    p = ellipsoid.scaleToGeodeticSurface(p, p);
                }

                n = ellipsoid.geodeticSurfaceNormal(p, n);

                Cartesian3.multiplyByScalar(n, height, n);
                Cartesian3.add(p, n, p);

                positions[i] = p.x;
                positions[i + 1] = p.y;
                positions[i + 2] = p.z;
            }
        }

        return geometry;
    };

    /**
     * Given a polygon defined by an outer ring with one or more inner rings (holes), return a single list of points representing
     * a polygon defined by the outer ring with the inner holes removed.
     *
     * @param {Cartesian2[]} outerRing An array of Cartesian points defining the outer boundary of the polygon.
     * @param {Cartesian2[]} innerRings An array of arrays of Cartesian points, where each array represents a hole in the polygon.
     * @returns A single list of Cartesian points defining the polygon, including the eliminated inner ring.
     *
     * @exception {DeveloperError} <code>outerRing</code> must not be empty.
     *
     * @example
     * // Simplifying a polygon with multiple holes.
     * outerRing = Cesium.PolygonPipeline.eliminateHoles(outerRing, innerRings);
     * polygon.positions = outerRing;
     */
    PolygonPipeline.eliminateHoles = function(outerRing, innerRings, ellipsoid) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(outerRing)) {
            throw new DeveloperError('outerRing is required.');
        }
        if (outerRing.length === 0) {
            throw new DeveloperError('outerRing must not be empty.');
        }
        if (!defined(innerRings)) {
            throw new DeveloperError('innerRings is required.');
        }
        //>>includeEnd('debug');

        ellipsoid = defaultValue(ellipsoid, Ellipsoid.WGS84);

        var innerRingsCopy = [];
        for ( var i = 0; i < innerRings.length; i++) {
            var innerRing = [];
            for ( var j = 0; j < innerRings[i].length; j++) {
                innerRing.push(Cartesian3.clone(innerRings[i][j]));
            }
            innerRingsCopy.push(innerRing);
        }

        var newPolygonVertices = outerRing;
        while (innerRingsCopy.length > 0) {
            newPolygonVertices = eliminateHole(newPolygonVertices, innerRingsCopy, ellipsoid);
        }
        return newPolygonVertices;
    };

    return PolygonPipeline;
});
