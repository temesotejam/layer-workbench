import unittest
from three_mf_instance_expansion import IDENTITY_3MF, compose_3mf, expand_scene


def obj(mesh=False, triangles=0, components=()):
    return {'mesh': mesh, 'triangles': triangles,
            'componentInstances': [{'objectId': name, 'transform3mf': tr}
                                   for name, tr in components]}


def trans(x, y, z):
    return IDENTITY_3MF[:9] + [x, y, z]


class TestExpansion(unittest.TestCase):
    def test_row_vector_order_rotated_component(self):
        rot90 = [0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0]
        self.assertEqual(compose_3mf(trans(10, 0, 0), rot90)[9:], [0, 10, 0])
        self.assertEqual(compose_3mf(rot90, trans(20, 0, 0))[9:], [20, 0, 0])

    def test_nested_assembly_and_multiple_placements(self):
        objs = {'1': obj(mesh=True, triangles=12),
                '2': obj(components=[('1', trans(5, 0, 0))]),
                '3': obj(components=[('2', trans(0, 7, 0))])}
        items = [{'objectId': '3', 'transform3mf': trans(100, 200, 0)},
                 {'objectId': '1', 'transform3mf': IDENTITY_3MF}]
        result = expand_scene(objs, items)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]['transform3mf'][9:], [105, 207, 0])
        self.assertEqual(result[0]['objectPath'], ['3', '2', '1'])
        self.assertEqual(result[1]['triangles'], 12)

    def test_repeated_components_are_not_cycles(self):
        objs = {'1': obj(mesh=True, triangles=12),
                '2': obj(components=[('1', trans(0,0,0)), ('1', trans(10,0,0))])}
        result = expand_scene(objs, [{'objectId':'2','transform3mf': IDENTITY_3MF}])
        self.assertEqual([x['transform3mf'][9] for x in result], [0,10])

    def test_cycle_even_when_unreferenced(self):
        objs = {'1': obj(mesh=True,triangles=1),
                '2': obj(components=[('3', IDENTITY_3MF)]),
                '3': obj(components=[('2', IDENTITY_3MF)])}
        with self.assertRaisesRegex(ValueError, 'Cyclic'):
            expand_scene(objs, [{'objectId':'1','transform3mf': IDENTITY_3MF}])

    def test_rejects_missing_and_expansion_bomb(self):
        with self.assertRaisesRegex(ValueError,'missing'):
            expand_scene({'1': obj(components=[('2', IDENTITY_3MF)])}, [])
        objs={'1': obj(mesh=True,triangles=1)}
        for i in range(2,20):
            objs[str(i)] = obj(components=[(str(i-1), IDENTITY_3MF)]*2)
        with self.assertRaisesRegex(ValueError,'exceed audit limit'):
            expand_scene(objs,[{'objectId':'19','transform3mf':IDENTITY_3MF}],max_instances=16)

    def test_overlarge_composed_translation_fails_closed(self):
        with self.assertRaisesRegex(ValueError,'Excessive'):
            compose_3mf(trans(1e9,0,0), trans(1e9,0,0))


if __name__ == '__main__':
    unittest.main()
