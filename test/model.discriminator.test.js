'use strict';

/**
 * Test dependencies.
 */

const start = require('./common');

const assert = require('assert');
const clone = require('../lib/utils').clone;
const co = require('co');
const random = require('../lib/utils').random;
const util = require('util');

const mongoose = start.mongoose;
const Schema = mongoose.Schema;

/**
 * Setup
 */
const PersonSchema = new Schema({
  name: { first: String, last: String },
  gender: String
}, { collection: 'model-discriminator-' + random() });
PersonSchema.index({ name: 1 });
PersonSchema.methods.getFullName = function() {
  return this.name.first + ' ' + this.name.last;
};
PersonSchema.methods.toJSonConfig = {
  include: ['prop1', 'prop2'],
  exclude: ['prop3', 'prop4']
};
PersonSchema.statics.findByGender = function() {
};
PersonSchema.virtual('name.full').get(function() {
  return this.name.first + ' ' + this.name.last;
});
PersonSchema.virtual('name.full').set(function(name) {
  const split = name.split(' ');
  this.name.first = split[0];
  this.name.last = split[1];
});
PersonSchema.path('gender').validate(function(value) {
  return /[A-Z]/.test(value);
}, 'Invalid name');
PersonSchema.set('toObject', { getters: true, virtuals: true });
PersonSchema.set('toJSON', { getters: true, virtuals: true });

const EmployeeSchema = new Schema({ department: String });
EmployeeSchema.index({ department: 1 });
EmployeeSchema.methods.getDepartment = function() {
  return this.department;
};
EmployeeSchema.statics.findByDepartment = function() {
};
EmployeeSchema.path('department').validate(function(value) {
  return /[a-zA-Z]/.test(value);
}, 'Invalid name');
const employeeSchemaPreSaveFn = function(next) {
  next();
};
EmployeeSchema.pre('save', employeeSchemaPreSaveFn);
EmployeeSchema.set('toObject', { getters: true, virtuals: false });
EmployeeSchema.set('toJSON', { getters: false, virtuals: true });

describe('model', function() {
  let db;

  before(function() {
    db = start();
  });

  after(function(done) {
    db.close(done);
  });

  beforeEach(() => db.deleteModel(/.*/));
  afterEach(() => require('./util').clearTestData(db));
  afterEach(() => require('./util').stopRemainingOps(db));

  describe('discriminator()', function() {
    let Person, Employee;

    before(function() {
      db = start();
      Person = db.model('Test', PersonSchema);
      Employee = Person.discriminator('Employee', EmployeeSchema);
    });

    it('model defaults without discriminator', function() {
      const Model = db.model('Test1', new Schema());
      assert.equal(Model.discriminators, undefined);
    });

    it('is instance of root', function() {
      assert.equal(Employee.baseModelName, 'Test');
      const employee = new Employee();
      assert.ok(employee instanceof Person);
      assert.ok(employee instanceof Employee);
      assert.strictEqual(employee.__proto__.constructor, Employee);
      assert.strictEqual(employee.__proto__.__proto__.constructor, Person);
    });

    it('can define static and instance methods', function() {
      function BossBaseSchema() {
        Schema.apply(this, arguments);

        this.add({
          name: String,
          createdAt: Date
        });
      }

      util.inherits(BossBaseSchema, Schema);

      const PersonSchema = new BossBaseSchema();
      const BossSchema = new BossBaseSchema({ department: String });
      BossSchema.methods.myName = function() {
        return this.name;
      };
      BossSchema.statics.currentPresident = function() {
        return 'obama';
      };
      const Person = db.model('Person', PersonSchema);
      const Boss = Person.discriminator('Boss', BossSchema);

      const boss = new Boss({ name: 'Bernenke' });
      assert.equal(boss.myName(), 'Bernenke');
      assert.equal(boss.notInstanceMethod, undefined);
      assert.equal(Boss.currentPresident(), 'obama');
      assert.equal(Boss.notStaticMethod, undefined);
    });

    it('sets schema root discriminator mapping', function(done) {
      assert.deepEqual(Person.schema.discriminatorMapping, { key: '__t', value: null, isRoot: true });
      done();
    });

    it('sets schema discriminator type mapping', function(done) {
      assert.deepEqual(Employee.schema.discriminatorMapping, { key: '__t', value: 'Employee', isRoot: false });
      done();
    });

    it('adds discriminatorKey to schema with default as name', function() {
      const type = Employee.schema.paths.__t;
      assert.equal(type.options.type, String);
      assert.equal(type.options.default, 'Employee');
    });

    it('adds discriminator to Model.discriminators object', function() {
      assert.equal(Object.keys(Person.discriminators).length, 1);
      assert.equal(Person.discriminators['Employee'], Employee);
      const newName = 'model-discriminator-' + random();
      const NewDiscriminatorType = Person.discriminator(newName, new Schema());
      assert.equal(Object.keys(Person.discriminators).length, 2);
      assert.equal(Person.discriminators[newName], NewDiscriminatorType);
    });

    it('throws error on invalid schema', function() {
      assert.throws(
        function() {
          Person.discriminator('Foo');
        },
        /You must pass a valid discriminator Schema/
      );
    });

    it('throws error when attempting to nest discriminators', function() {
      assert.throws(
        function() {
          Employee.discriminator('model-discriminator-foo', new Schema());
        },
        /Discriminator "model-discriminator-foo" can only be a discriminator of the root model/
      );
    });

    it('throws error when discriminator has mapped discriminator key in schema', function() {
      assert.throws(
        function() {
          Person.discriminator('model-discriminator-foo', new Schema({ __t: String }));
        },
        /Discriminator "model-discriminator-foo" cannot have field with name "__t"/
      );
    });

    it('throws error when discriminator has mapped discriminator key in schema with discriminatorKey option set', function() {
      assert.throws(
        function() {
          const Foo = db.model('Test1', new Schema({}, { discriminatorKey: '_type' }));
          Foo.discriminator('Bar', new Schema({ _type: String }));
        },
        /Discriminator "Bar" cannot have field with name "_type"/
      );
    });

    it('throws error when discriminator with taken name is added', function() {
      const Foo = db.model('Test1', new Schema({}));
      Foo.discriminator('Token', new Schema());
      assert.throws(
        function() {
          Foo.discriminator('Token', new Schema());
        },
        /Discriminator with name "Token" already exists/
      );
    });

    it('throws error if model name is taken (gh-4148)', function() {
      const Foo = db.model('Test1', new Schema({}));
      db.model('Test', new Schema({}));
      assert.throws(
        function() {
          Foo.discriminator('Test', new Schema());
        },
        /Cannot overwrite `Test`/);
    });

    it('works with nested schemas (gh-2821)', function(done) {
      const MinionSchema = function() {
        mongoose.Schema.apply(this, arguments);

        this.add({
          name: String
        });
      };
      util.inherits(MinionSchema, mongoose.Schema);

      const BaseSchema = function() {
        mongoose.Schema.apply(this, arguments);

        this.add({
          name: String,
          created_at: Date,
          minions: [new MinionSchema()]
        });
      };
      util.inherits(BaseSchema, mongoose.Schema);

      const PersonSchema = new BaseSchema();
      const BossSchema = new BaseSchema({
        department: String
      }, { id: false });

      // Should not throw
      const Person = db.model('Test1', PersonSchema);
      Person.discriminator('Boss', BossSchema);
      done();
    });

    describe('options', function() {
      it('allows toObject to be overridden', function(done) {
        assert.notDeepEqual(Employee.schema.get('toObject'), Person.schema.get('toObject'));
        assert.deepEqual(Employee.schema.get('toObject'), { getters: true, virtuals: false });
        done();
      });

      it('allows toJSON to be overridden', function(done) {
        assert.notDeepEqual(Employee.schema.get('toJSON'), Person.schema.get('toJSON'));
        assert.deepEqual(Employee.schema.get('toJSON'), { getters: false, virtuals: true });
        done();
      });

      it('is not customizable', function() {
        const CustomizedSchema = new Schema({}, { capped: true });

        assert.throws(function() {
          Person.discriminator('model-discriminator-custom', CustomizedSchema);
        }, /Can't customize discriminator option capped/);
      });
    });

    describe('root schema inheritance', function() {
      it('inherits field mappings', function() {
        assert.strictEqual(Employee.schema.path('name'), Person.schema.path('name'));
        assert.strictEqual(Employee.schema.path('gender'), Person.schema.path('gender'));
        assert.equal(Person.schema.paths.department, undefined);
      });

      it('inherits validators', function() {
        assert.strictEqual(Employee.schema.path('gender').validators, PersonSchema.path('gender').validators);
        assert.deepEqual(Employee.schema.path('department').validators,
          EmployeeSchema.path('department').validators);
      });

      it('does not inherit and override fields that exist', function() {
        const FemaleSchema = new Schema({ gender: { type: String, default: 'F' } }),
            Female = Person.discriminator('model-discriminator-female', FemaleSchema);

        const gender = Female.schema.paths.gender;

        assert.notStrictEqual(gender, Person.schema.paths.gender);
        assert.equal(gender.instance, 'String');
        assert.equal(gender.options.default, 'F');
      });

      it('inherits methods', function() {
        const employee = new Employee();
        assert.strictEqual(employee.getFullName, PersonSchema.methods.getFullName);
        assert.strictEqual(employee.getDepartment, EmployeeSchema.methods.getDepartment);
        assert.equal((new Person).getDepartment, undefined);
      });

      it('inherits statics', function() {
        assert.strictEqual(Employee.findByGender, PersonSchema.statics.findByGender);
        assert.strictEqual(Employee.findByDepartment, EmployeeSchema.statics.findByDepartment);
        assert.equal(Person.findByDepartment, undefined);
      });

      it('inherits virtual (g.s)etters', function() {
        const employee = new Employee();
        employee.name.full = 'John Doe';
        assert.equal(employee.name.full, 'John Doe');
      });

      it('does not inherit indexes', function() {
        assert.deepEqual(Person.schema.indexes(), [[{ name: 1 }, { background: true }]]);
        assert.deepEqual(Employee.schema.indexes(), [[{ department: 1 }, { background: true }]]);
      });

      it('gets options overridden by root options except toJSON and toObject', function() {
        const personOptions = clone(Person.schema.options),
            employeeOptions = clone(Employee.schema.options);

        delete personOptions.toJSON;
        delete personOptions.toObject;
        delete employeeOptions.toJSON;
        delete employeeOptions.toObject;

        assert.deepEqual(personOptions, employeeOptions);
      });

      it('does not allow setting discriminator key (gh-2041)', function(done) {
        const doc = new Employee({ __t: 'fake' });
        assert.equal(doc.__t, 'Employee');
        doc.save(function(error) {
          assert.ok(error);
          assert.equal(error.errors['__t'].reason.message,
            'Can\'t set discriminator key "__t"');
          done();
        });
      });

      it('deduplicates hooks (gh-2945)', function() {
        let called = 0;
        function middleware(next) {
          ++called;
          next();
        }

        function ActivityBaseSchema() {
          mongoose.Schema.apply(this, arguments);
          this.options.discriminatorKey = 'type';
          this.add({ name: String });
          this.pre('validate', middleware);
        }
        util.inherits(ActivityBaseSchema, mongoose.Schema);

        const parentSchema = new ActivityBaseSchema();

        const model = db.model('Test1', parentSchema);

        const commentSchema = new ActivityBaseSchema({
          text: { type: String, required: true }
        });

        const D = model.discriminator('D', commentSchema);

        return new D({ text: 'test' }).validate().
          then(() => {
            assert.equal(called, 1);
          });
      });

      it('with typeKey (gh-4339)', function() {
        const options = { typeKey: '$type', discriminatorKey: '_t' };
        const schema = new Schema({ test: { $type: String } }, options);
        const Model = db.model('Test', schema);
        Model.discriminator('D', new Schema({
          test2: String
        }, { typeKey: '$type' }));
      });

      describe('applyPluginsToDiscriminators', function() {
        let m;

        beforeEach(function() {
          m = new mongoose.Mongoose();
          m.set('applyPluginsToDiscriminators', true);
        });

        it('works (gh-4965)', function() {
          const schema = new m.Schema({ test: String });
          let called = 0;
          m.plugin(function() {
            ++called;
          });
          const Model = m.model('Test', schema);
          const childSchema = new m.Schema({
            test2: String
          });
          Model.discriminator('D', childSchema);
          assert.equal(called, 2);
        });

        it('works with customized options (gh-7458)', function() {
          m.plugin((schema) => {
            schema.options.versionKey = false;
            schema.options.minimize = false;
          });

          const schema = new m.Schema({
            type: { type: String },
            something: { type: String }
          }, {
            discriminatorKey: 'type'
          });
          const Model = m.model('Test', schema);

          const subSchema = new m.Schema({
            somethingElse: { type: String }
          });

          // Should not throw
          Model.discriminator('TestSub', subSchema);
        });
      });

      it('embedded discriminators with array defaults (gh-7687)', function() {
        const abstractSchema = new Schema({}, {
          discriminatorKey: 'kind',
          _id: false
        });
        const concreteSchema = new Schema({ foo: { type: Number } });
        const defaultValue = [{ kind: 'concrete', foo: 42 }];

        const schema = new Schema({
          items: {
            type: [abstractSchema],
            default: defaultValue
          }
        });

        schema.path('items').discriminator('concrete', concreteSchema);

        const Thing = db.model('Test', schema);
        const doc = new Thing();

        assert.equal(doc.items[0].foo, 42);
        assert.equal(doc.items[0].constructor.name, 'concrete');

        return Promise.resolve();
      });

      it('embedded discriminators with create() (gh-5001)', function() {
        const eventSchema = new Schema({ message: String },
          { discriminatorKey: 'kind', _id: false });
        const batchSchema = new Schema({ events: [eventSchema] });
        const docArray = batchSchema.path('events');

        docArray.discriminator('Clicked', new Schema({
          element: {
            type: String,
            required: true
          }
        }, { _id: false }));

        const Purchased = docArray.discriminator('Purchased', new Schema({
          product: {
            type: String,
            required: true
          }
        }, { _id: false }));

        const Batch = db.model('Test', batchSchema);

        const batch = {
          events: [
            { kind: 'Clicked', element: '#hero' }
          ]
        };

        return Batch.create(batch).
          then(function(doc) {
            assert.equal(doc.events.length, 1);
            const newDoc = doc.events.create({
              kind: 'Purchased',
              product: 'action-figure-1'
            });
            assert.equal(newDoc.kind, 'Purchased');
            assert.equal(newDoc.product, 'action-figure-1');
            assert.ok(newDoc instanceof Purchased);

            doc.events.push(newDoc);
            assert.equal(doc.events.length, 2);
            assert.equal(doc.events[1].kind, 'Purchased');
            assert.equal(doc.events[1].product, 'action-figure-1');
            assert.ok(newDoc instanceof Purchased);
            assert.ok(newDoc === doc.events[1]);
          });
      });

      it('embedded discriminator with numeric type (gh-7808)', function() {
        const typesSchema = Schema({
          type: { type: Number }
        }, { discriminatorKey: 'type', _id: false });

        const mainSchema = Schema({
          types: [typesSchema]
        });

        mainSchema.path('types').discriminator(1,
          Schema({ foo: { type: String, default: 'bar' } }));
        mainSchema.path('types').discriminator(2,
          Schema({ hello: { type: String, default: 'world' } }));

        const Model = db.model('Test1', mainSchema);

        return co(function*() {
          yield Model.create({
            types: [{ type: 1 }, { type: 2 }]
          });
          const fromDb = yield Model.collection.findOne();
          assert.equal(fromDb.types.length, 2);
          assert.equal(fromDb.types[0].foo, 'bar');
          assert.equal(fromDb.types[1].hello, 'world');
        });
      });

      it('supports clone() (gh-4983)', function(done) {
        const childSchema = new Schema({
          name: String
        });
        let childCalls = 0;
        let childValidateCalls = 0;
        const preValidate = function preValidate(next) {
          ++childValidateCalls;
          next();
        };
        childSchema.pre('validate', preValidate);
        childSchema.pre('save', function(next) {
          ++childCalls;
          next();
        });

        const personSchema = new Schema({
          name: String
        }, { discriminatorKey: 'kind' });

        const parentSchema = new Schema({
          children: [childSchema],
          heir: childSchema
        });
        let parentCalls = 0;
        parentSchema.pre('save', function(next) {
          ++parentCalls;
          next();
        });

        const Person = db.model('Person', personSchema);
        const Parent = Person.discriminator('Parent', parentSchema.clone());

        const obj = {
          name: 'Ned Stark',
          heir: { name: 'Robb Stark' },
          children: [{ name: 'Jon Snow' }]
        };
        const doc = new Parent(obj);

        doc.save(function(error, doc) {
          assert.ifError(error);
          assert.equal(doc.name, 'Ned Stark');
          assert.equal(doc.heir.name, 'Robb Stark');
          assert.equal(doc.children.length, 1);
          assert.equal(doc.children[0].name, 'Jon Snow');
          assert.equal(childValidateCalls, 2);
          assert.equal(childCalls, 2);
          assert.equal(parentCalls, 1);
          done();
        });
      });

      it('clone() allows reusing schemas (gh-5098)', function() {
        const personSchema = new Schema({
          name: String
        }, { discriminatorKey: 'kind' });

        const parentSchema = new Schema({
          child: String
        });

        const Person = db.model('Person', personSchema);
        Person.discriminator('Parent', parentSchema.clone());
        // Should not throw
        Person.discriminator('Parent2', parentSchema.clone());
      });

      it('clone() allows reusing with different models (gh-5721)', function(done) {
        const schema = new mongoose.Schema({
          name: String
        });

        const schemaExt = new mongoose.Schema({
          nameExt: String
        });

        const ModelA = db.model('Test1', schema);
        ModelA.discriminator('D1', schemaExt);

        ModelA.findOneAndUpdate({}, { $set: { name: 'test' } }, function(error) {
          assert.ifError(error);

          const ModelB = db.model('Test2', schema.clone());
          ModelB.discriminator('D2', schemaExt.clone());

          done();
        });
      });

      it('incorrect discriminator key throws readable error with create (gh-6434)', function() {
        return co(function*() {
          const settingSchema = new Schema({ name: String }, {
            discriminatorKey: 'kind'
          });

          const defaultAdvisorSchema = new Schema({
            _advisor: String
          });

          const Setting = db.model('Test', settingSchema);
          Setting.discriminator('DefaultAdvisor',
            defaultAdvisorSchema);

          let threw = false;
          try {
            yield Setting.create({
              kind: 'defaultAdvisor',
              name: 'xyz'
            });
          } catch (error) {
            threw = true;
            assert.equal(error.name, 'MongooseError');
            assert.equal(error.message, 'Discriminator "defaultAdvisor" not ' +
              'found for model "Test"');
          }
          assert.ok(threw);
        });
      });

      it('copies query hooks (gh-5147)', function(done) {
        const options = { discriminatorKey: 'kind' };

        const eventSchema = new mongoose.Schema({ time: Date }, options);
        let eventSchemaCalls = 0;
        eventSchema.pre('findOneAndUpdate', function() {
          ++eventSchemaCalls;
        });

        const Event = db.model('Test', eventSchema);

        const clickedEventSchema = new mongoose.Schema({ url: String }, options);
        let clickedEventSchemaCalls = 0;
        clickedEventSchema.pre('findOneAndUpdate', function() {
          ++clickedEventSchemaCalls;
        });
        const ClickedLinkEvent = Event.discriminator('ClickedLink', clickedEventSchema);

        ClickedLinkEvent.findOneAndUpdate({}, { time: new Date() }, {}).
          exec(function(error) {
            assert.ifError(error);
            assert.equal(eventSchemaCalls, 1);
            assert.equal(clickedEventSchemaCalls, 1);
            done();
          });
      });

      it('reusing schema for discriminators (gh-5684)', function() {
        const ParentSchema = new Schema({});
        const ChildSchema = new Schema({ name: String });

        const FirstContainerSchema = new Schema({
          stuff: [ParentSchema]
        });

        FirstContainerSchema.path('stuff').discriminator('Child', ChildSchema);

        const SecondContainerSchema = new Schema({
          things: [ParentSchema]
        });

        SecondContainerSchema.path('things').discriminator('Child', ChildSchema);

        const M1 = db.model('Test1', FirstContainerSchema);
        const M2 = db.model('Test2', SecondContainerSchema);

        const doc1 = new M1({ stuff: [{ __t: 'Child', name: 'test' }] });
        const doc2 = new M2({ things: [{ __t: 'Child', name: 'test' }] });

        assert.equal(doc1.stuff.length, 1);
        assert.equal(doc1.stuff[0].name, 'test');
        assert.equal(doc2.things.length, 1);
        assert.equal(doc2.things[0].name, 'test');
      });

      it('overwrites nested paths in parent schema (gh-6076)', function() {
        const schema = mongoose.Schema({
          account: {
            type: Object
          }
        });

        const Model = db.model('Test1', schema);

        const discSchema = mongoose.Schema({
          account: {
            user: {
              ref: 'Foo',
              required: true,
              type: mongoose.Schema.Types.ObjectId
            }
          }
        });

        const Disc = Model.discriminator('D', discSchema);

        const d1 = new Disc({
          account: {
            user: 'AAAAAAAAAAAAAAAAAAAAAAAA'
          },
          info: 'AAAAAAAAAAAAAAAAAAAAAAAA'
        });

        assert.ifError(d1.validateSync());
      });

      it('nested discriminator key with projecting in parent (gh-5775)', function(done) {
        const itemSchema = new Schema({
          type: { type: String },
          active: { type: Boolean, default: true }
        }, { discriminatorKey: 'type' });

        const collectionSchema = new Schema({
          items: [itemSchema]
        });

        const s = new Schema({ count: Number });
        collectionSchema.path('items').discriminator('type1', s);

        const MyModel = db.model('Test', collectionSchema);
        const doc = {
          items: [{ type: 'type1', active: false, count: 3 }]
        };
        MyModel.create(doc, function(error) {
          assert.ifError(error);
          MyModel.findOne({}).select('items').exec(function(error, doc) {
            assert.ifError(error);
            assert.equal(doc.items.length, 1);
            assert.equal(doc.items[0].type, 'type1');
            assert.strictEqual(doc.items[0].active, false);
            assert.strictEqual(doc.items[0].count, 3);
            done();
          });
        });
      });

      it('with $meta projection (gh-5859)', function() {
        const eventSchema = new Schema({ eventField: String }, { id: false });
        eventSchema.index({ eventField: 'text' });
        const Event = db.model('Test', eventSchema);

        const trackSchema = new Schema({ trackField: String });
        const Track = Event.discriminator('Track', trackSchema);

        const trackedItem = new Track({
          trackField: 'track',
          eventField: 'event'
        });

        return trackedItem.save().
          then(() => Event.init()).
          then(function() {
            return Event.find({ $text: { $search: 'event' } }).
              select({ score: { $meta: 'textScore' } });
          }).
          then(function(docs) {
            assert.equal(docs.length, 1);
            assert.equal(docs[0].trackField, 'track');
          }).
          then(function() {
            return Track.find({ $text: { $search: 'event' } }).
              select({ score: { $meta: 'textScore' } });
          }).
          then(function(docs) {
            assert.equal(docs.length, 1);
            assert.equal(docs[0].trackField, 'track');
            assert.equal(docs[0].eventField, 'event');
          });
      });

      it('embedded discriminators with $push (gh-5009)', function(done) {
        const eventSchema = new Schema({ message: String },
          { discriminatorKey: 'kind', _id: false });
        const batchSchema = new Schema({ events: [eventSchema] });
        const docArray = batchSchema.path('events');

        docArray.discriminator('Clicked', new Schema({
          element: {
            type: String,
            required: true
          }
        }, { _id: false }));

        docArray.discriminator('Purchased', new Schema({
          product: {
            type: String,
            required: true
          }
        }, { _id: false }));

        const Batch = db.model('Test', batchSchema);

        const batch = {
          events: [
            { kind: 'Clicked', element: '#hero' }
          ]
        };

        Batch.create(batch).
          then(function(doc) {
            assert.equal(doc.events.length, 1);
            return Batch.updateOne({ _id: doc._id }, {
              $push: {
                events: { kind: 'Clicked', element: '#button' }
              }
            }).then(function() {
              return doc;
            });
          }).
          then(function(doc) {
            return Batch.findOne({ _id: doc._id });
          }).
          then(function(doc) {
            assert.equal(doc.events.length, 2);
            assert.equal(doc.events[1].element, '#button');
            assert.equal(doc.events[1].kind, 'Clicked');
            done();
          }).
          catch(done);
      });

      it('embedded discriminators with $push + $each (gh-5070)', function(done) {
        const eventSchema = new Schema({ message: String },
          { discriminatorKey: 'kind', _id: false });
        const batchSchema = new Schema({ events: [eventSchema] });
        const docArray = batchSchema.path('events');

        docArray.discriminator('Clicked', new Schema({
          element: {
            type: String,
            required: true
          }
        }, { _id: false }));

        docArray.discriminator('Purchased', new Schema({
          product: {
            type: String,
            required: true
          }
        }, { _id: false }));

        const Batch = db.model('Test1', batchSchema);

        const batch = {
          events: [
            { kind: 'Clicked', element: '#hero' }
          ]
        };

        Batch.create(batch).
          then(function(doc) {
            assert.equal(doc.events.length, 1);
            return Batch.updateOne({ _id: doc._id }, {
              $push: {
                events: { $each: [{ kind: 'Clicked', element: '#button' }] }
              }
            }).then(function() {
              return doc;
            });
          }).
          then(function(doc) {
            return Batch.findOne({ _id: doc._id });
          }).
          then(function(doc) {
            assert.equal(doc.events.length, 2);
            assert.equal(doc.events[1].element, '#button');
            assert.equal(doc.events[1].kind, 'Clicked');
            done();
          }).
          catch(done);
      });

      it('embedded discriminators with $set (gh-5130)', function(done) {
        const eventSchema = new Schema({ message: String },
          { discriminatorKey: 'kind' });
        const batchSchema = new Schema({ events: [eventSchema] });
        const docArray = batchSchema.path('events');

        docArray.discriminator('Clicked', new Schema({
          element: {
            type: String,
            required: true
          }
        }));

        docArray.discriminator('Purchased', new Schema({
          product: {
            type: String,
            required: true
          }
        }));

        const Batch = db.model('Test1', batchSchema);

        const batch = {
          events: [
            { kind: 'Clicked', element: '#hero' }
          ]
        };

        Batch.create(batch).
          then(function(doc) {
            assert.equal(doc.events.length, 1);
            return Batch.updateOne({ _id: doc._id, 'events._id': doc.events[0]._id }, {
              $set: {
                'events.$': {
                  message: 'updated',
                  kind: 'Clicked',
                  element: '#hero2'
                }
              }
            }).then(function() { return doc; });
          }).
          then(function(doc) {
            return Batch.findOne({ _id: doc._id });
          }).
          then(function(doc) {
            assert.equal(doc.events.length, 1);
            assert.equal(doc.events[0].message, 'updated');
            assert.equal(doc.events[0].element, '#hero2'); // <-- test failed
            assert.equal(doc.events[0].kind, 'Clicked'); // <-- test failed
            done();
          }).
          catch(done);
      });

      it('embedded in document arrays (gh-2723)', function(done) {
        const eventSchema = new Schema({ message: String },
          { discriminatorKey: 'kind', _id: false });

        const batchSchema = new Schema({ events: [eventSchema] });
        batchSchema.path('events').discriminator('Clicked', new Schema({
          element: String
        }, { _id: false }));
        batchSchema.path('events').discriminator('Purchased', new Schema({
          product: String
        }, { _id: false }));

        const MyModel = db.model('Test1', batchSchema);
        const doc = {
          events: [
            { kind: 'Clicked', element: 'Test' },
            { kind: 'Purchased', product: 'Test2' }
          ]
        };
        MyModel.create(doc).
          then(function(doc) {
            assert.equal(doc.events.length, 2);
            assert.equal(doc.events[0].element, 'Test');
            assert.equal(doc.events[1].product, 'Test2');
            const obj = doc.toObject({ virtuals: false });
            delete obj._id;
            assert.deepEqual(obj, {
              __v: 0,
              events: [
                { kind: 'Clicked', element: 'Test' },
                { kind: 'Purchased', product: 'Test2' }
              ]
            });
          }).
          then(function() {
            return MyModel.findOne({
              events: {
                $elemMatch: {
                  kind: 'Clicked',
                  element: 'Test'
                }
              }
            }, { 'events.$': 1 });
          }).
          then(function(doc) {
            assert.ok(doc);
            assert.equal(doc.events.length, 1);
            assert.equal(doc.events[0].element, 'Test');
            done();
          }).
          catch(done);
      });
    });

    it('embedded with single nested subdocs (gh-5244)', function(done) {
      const eventSchema = new Schema({ message: String },
        { discriminatorKey: 'kind', _id: false });

      const trackSchema = new Schema({ event: eventSchema });
      trackSchema.path('event').discriminator('Clicked', new Schema({
        element: String
      }, { _id: false }));
      trackSchema.path('event').discriminator('Purchased', new Schema({
        product: String
      }, { _id: false }));

      const MyModel = db.model('Test1', trackSchema);
      const doc1 = {
        event: {
          kind: 'Clicked',
          element: 'Amazon Link'
        }
      };
      const doc2 = {
        event: {
          kind: 'Purchased',
          product: 'Professional AngularJS'
        }
      };
      MyModel.create([doc1, doc2]).
        then(function(docs) {
          const doc1 = docs[0];
          const doc2 = docs[1];

          assert.equal(doc1.event.kind, 'Clicked');
          assert.equal(doc1.event.element, 'Amazon Link');
          assert.ok(!doc1.event.product);

          assert.equal(doc2.event.kind, 'Purchased');
          assert.equal(doc2.event.product, 'Professional AngularJS');
          assert.ok(!doc2.event.element);
          done();
        }).
        catch(done);
    });

    it('embedded with single nested subdocs and tied value (gh-8164) (gh-9108)', function() {
      const eventSchema = new Schema({ message: String },
        { discriminatorKey: 'kind', _id: false });

      const trackSchema = new Schema({ event: eventSchema });
      trackSchema.path('event').discriminator('Clicked', new Schema({
        element: String
      }, { _id: false }), 'click');
      trackSchema.path('event').discriminator('Purchased', new Schema({
        product: String
      }, { _id: false }), 'purchase');

      const MyModel = db.model('Test1', trackSchema);
      let doc1 = {
        event: {
          kind: 'click',
          element: 'Amazon Link'
        }
      };
      let doc2 = {
        event: {
          kind: 'purchase',
          product: 'Professional AngularJS'
        }
      };
      return MyModel.create([doc1, doc2]).
        then(function(docs) {
          doc1 = docs[0];
          doc2 = docs[1];

          assert.equal(doc1.event.kind, 'click');
          assert.equal(doc1.event.element, 'Amazon Link');
          assert.ok(!doc1.event.product);

          assert.equal(doc2.event.kind, 'purchase');
          assert.equal(doc2.event.product, 'Professional AngularJS');
          assert.ok(!doc2.event.element);

          return MyModel.updateOne({ 'event.kind': 'click' }, {
            'event.element': 'Pluralsight Link'
          });
        }).
        then(() => MyModel.findById(doc1._id)).
        then(doc => {
          assert.equal(doc.event.element, 'Pluralsight Link');
        });
    });

    it('supports ObjectId as tied value (gh-10130)', function() {
      const eventSchema = new Schema({ message: String, kind: 'ObjectId' },
        { discriminatorKey: 'kind' });

      const Event = db.model('Event', eventSchema);
      const clickedId = new mongoose.Types.ObjectId();
      const purchasedId = new mongoose.Types.ObjectId();
      Event.discriminator('Clicked', new Schema({
        element: String
      }), clickedId);
      Event.discriminator('Purchased', new Schema({
        product: String
      }), purchasedId);

      return co(function*() {
        yield Event.create([
          { message: 'test', element: '#buy', kind: clickedId },
          { message: 'test2', product: 'Turbo Man', kind: purchasedId }
        ]);

        const docs = yield Event.find().sort({ message: 1 });
        assert.equal(docs.length, 2);
        assert.equal(docs[0].kind.toHexString(), clickedId.toHexString());
        assert.equal(docs[0].element, '#buy');
        assert.equal(docs[1].kind.toHexString(), purchasedId.toHexString());
        assert.equal(docs[1].product, 'Turbo Man');
      });
    });

    it('Embedded discriminators in nested doc arrays (gh-6202)', function() {
      const eventSchema = new Schema({ message: String }, {
        discriminatorKey: 'kind',
        _id: false
      });

      const batchSchema = new Schema({ events: [[eventSchema]] });
      const docArray = batchSchema.path('events');

      const clickedSchema = new Schema({
        element: { type: String, required: true }
      }, { _id: false });
      docArray.discriminator('Clicked', clickedSchema);

      const M = db.model('Test1', batchSchema);

      return M.create({ events: [[{ kind: 'Clicked', element: 'foo' }]] }).
        then(() => M.findOne()).
        then(doc => {
          assert.deepEqual(doc.toObject().events[0][0], {
            kind: 'Clicked',
            element: 'foo'
          });
        });
    });

    it('throws an error if calling discriminator on non-doc array (gh-6202)', function() {
      const batchSchema = new Schema({ events: [[Number]] });
      const arr = batchSchema.path('events');

      const clickedSchema = new Schema({
        element: { type: String, required: true }
      }, { _id: false });

      let threw = false;
      try {
        arr.discriminator('Clicked', clickedSchema);
      } catch (error) {
        threw = true;
        assert.ok(error.message.indexOf('embedded discriminator') !== -1,
          error.message);
      }
      assert.ok(threw);
    });

    it('supports using a schema that was used for another discriminator (gh-7200)', function() {
      const schema = new Schema({
        name: String,
        names: [{
          name: String
        }]
      });

      const conA = mongoose.createConnection(start.uri);

      const schemaExt = new Schema({ nameExt: String });

      const modelA = conA.model('Test', schema);
      modelA.discriminator('AExt', schemaExt);

      const conB = mongoose.createConnection(start.uri);

      const modelB = conB.model('Test1', schema);
      modelB.discriminator('AExt', schemaExt);

    });

    describe('embedded discriminators + hooks (gh-5706)', function() {
      const counters = {
        eventPreSave: 0,
        eventPostSave: 0,
        purchasePreSave: 0,
        purchasePostSave: 0,
        eventPreValidate: 0,
        eventPostValidate: 0,
        purchasePreValidate: 0,
        purchasePostValidate: 0
      };
      const eventSchema = new Schema(
        { message: String },
        { discriminatorKey: 'kind', _id: false }
      );
      eventSchema.pre('validate', function(next) {
        counters.eventPreValidate++;
        next();
      });

      eventSchema.post('validate', function() {
        counters.eventPostValidate++;
      });

      eventSchema.pre('save', function(next) {
        counters.eventPreSave++;
        next();
      });

      eventSchema.post('save', function() {
        counters.eventPostSave++;
      });

      const purchasedSchema = new Schema({
        product: String
      }, { _id: false });

      purchasedSchema.pre('validate', function(next) {
        counters.purchasePreValidate++;
        next();
      });

      purchasedSchema.post('validate', function() {
        counters.purchasePostValidate++;
      });

      purchasedSchema.pre('save', function(next) {
        counters.purchasePreSave++;
        next();
      });

      purchasedSchema.post('save', function() {
        counters.purchasePostSave++;
      });

      beforeEach(function() {
        Object.keys(counters).forEach(function(i) {
          counters[i] = 0;
        });
      });

      it('should call the hooks on the embedded document defined by both the parent and discriminated schemas', function(done) {
        const trackSchema = new Schema({
          event: eventSchema
        });

        const embeddedEventSchema = trackSchema.path('event');
        embeddedEventSchema.discriminator('Purchased', purchasedSchema.clone());

        const TrackModel = db.model('Track', trackSchema);
        const doc = new TrackModel({
          event: {
            message: 'Test',
            kind: 'Purchased'
          }
        });
        doc.save(function(err) {
          assert.ok(!err);
          assert.equal(doc.event.message, 'Test');
          assert.equal(doc.event.kind, 'Purchased');
          Object.keys(counters).forEach(function(i) {
            assert.equal(counters[i], 1, 'Counter ' + i + ' incorrect');
          });
          done();
        });
      });

      it('should call the hooks on the embedded document in an embedded array defined by both the parent and discriminated schemas', function(done) {
        const trackSchema = new Schema({
          events: [eventSchema]
        });

        const embeddedEventSchema = trackSchema.path('events');
        embeddedEventSchema.discriminator('Purchased', purchasedSchema.clone());

        const TrackModel = db.model('Track', trackSchema);
        const doc = new TrackModel({
          events: [
            {
              message: 'Test',
              kind: 'Purchased'
            },
            {
              message: 'TestAgain',
              kind: 'Purchased'
            }
          ]
        });
        doc.save(function(err) {
          assert.ok(!err);
          assert.equal(doc.events[0].kind, 'Purchased');
          assert.equal(doc.events[0].message, 'Test');
          assert.equal(doc.events[1].kind, 'Purchased');
          assert.equal(doc.events[1].message, 'TestAgain');
          Object.keys(counters).forEach(function(i) {
            assert.equal(counters[i], 2);
          });
          done();
        });
      });
    });

    it('should copy plugins', function() {
      const plugin = () => { };

      const schema = new Schema({ value: String }, {
        autoIndex: false,
        autoCreate: false
      });
      schema.plugin(plugin);
      mongoose.deleteModel(/Test/);
      const model = mongoose.model('Test', schema);

      const discriminator = model.discriminator('Desc', new Schema({ anotherValue: String }));

      const copiedPlugin = discriminator.schema.plugins.find(p => p.fn === plugin);
      assert.ok(!!copiedPlugin);

      mongoose.deleteModel(/Model/);
    });
  });

  describe('bug fixes', function() {
    it('discriminators with classes modifies class in place (gh-5175)', function(done) {
      class Vehicle extends mongoose.Model { }
      const V = mongoose.model(Vehicle, new mongoose.Schema());
      assert.ok(V === Vehicle);
      class Car extends Vehicle { }
      const C = Vehicle.discriminator(Car, new mongoose.Schema());
      assert.ok(C === Car);
      done();
    });

    it('allows overwriting base class methods (gh-5227)', function(done) {
      class BaseModel extends mongoose.Model {
        getString() {
          return 'parent';
        }
      }

      class Test extends BaseModel {
        getString() {
          return 'child';
        }
      }

      mongoose.deleteModel(/Test/);
      const UserModel = mongoose.model(Test, new mongoose.Schema({}));

      const u = new UserModel({});

      assert.equal(u.getString(), 'child');

      done();
    });

    it('supports adding properties (gh-5104) (gh-5635)', function(done) {
      class Shape extends mongoose.Model { }
      class Circle extends Shape { }

      const ShapeModel = mongoose.model(Shape, new mongoose.Schema({
        color: String
      }));

      ShapeModel.discriminator(Circle, new mongoose.Schema({
        radius: Number
      }));

      const circle = new Circle({ color: 'blue', radius: 3 });
      assert.equal(circle.color, 'blue');
      assert.equal(circle.radius, 3);

      done();
    });

    it('with subclassing (gh-7547)', function() {
      const options = { discriminatorKey: 'kind' };

      const eventSchema = new mongoose.Schema({ time: Date }, options);
      mongoose.deleteModel(/Test/);
      const eventModelUser1 =
        mongoose.model('Test', eventSchema, 'tests');
      const eventModelUser2 =
        mongoose.model('Test', eventSchema, 'test1');

      const discSchema = new mongoose.Schema({ url: String }, options);
      const clickEventUser1 = eventModelUser1.
        discriminator('ClickedEvent', discSchema);
      const clickEventUser2 =
        eventModelUser2.discriminators['ClickedEvent'];

      assert.equal(clickEventUser1.collection.name, 'tests');
      assert.equal(clickEventUser2.collection.name, 'test1');
    });

    it('uses correct discriminator when using `new BaseModel` (gh-7586)', function() {
      const options = { discriminatorKey: 'kind' };

      const BaseModel = mongoose.model('Parent',
        Schema({ name: String }, options));
      const ChildModel = BaseModel.discriminator('Child',
        Schema({ test: String }, options));

      const doc = new BaseModel({ kind: 'Child', name: 'a', test: 'b' });
      assert.ok(doc instanceof ChildModel);
      assert.equal(doc.test, 'b');
    });

    it('uses correct discriminator when using `new BaseModel` with value (gh-7851)', function() {
      const options = { discriminatorKey: 'kind' };

      const BaseModel = db.model('Parent',
        Schema({ name: String }, options));
      const ChildModel = BaseModel.discriminator('Child',
        Schema({ test: String }, options), 'child');

      const doc = new BaseModel({ kind: 'child', name: 'a', test: 'b' });
      assert.ok(doc instanceof ChildModel);
      assert.equal(doc.test, 'b');
    });

    it('allows setting custom discriminator key in schema (gh-7807)', function() {
      const eventSchema = Schema({
        title: String,
        kind: { type: String, required: true }
      }, { discriminatorKey: 'kind' });

      const Event = db.model('Test', eventSchema);
      Event.discriminator('Clicked',
        Schema({ url: String }));

      const doc = new Event({ title: 'foo' });

      return doc.validate().then(() => assert.ok(false), err => {
        assert.ok(err);
        assert.ok(err.errors['kind']);
        assert.ok(err.errors['kind'].message.indexOf('required') !== -1,
          err.errors['kind'].message);
      });
    });

    it('does not project in embedded discriminator key if it is the only selected field (gh-7574)', function() {
      const sectionSchema = Schema({ title: String }, { discriminatorKey: 'kind' });
      const imageSectionSchema = Schema({ href: String });
      const textSectionSchema = Schema({ text: String });

      const documentSchema = Schema({
        title: String,
        sections: [sectionSchema]
      });

      const sectionsType = documentSchema.path('sections');
      sectionsType.discriminator('image', imageSectionSchema);
      sectionsType.discriminator('text', textSectionSchema);

      const Model = db.model('Test', documentSchema);

      return co(function*() {
        yield Model.create({
          title: 'example',
          sections: [
            { kind: 'image', title: 'image', href: 'foo' },
            { kind: 'text', title: 'text', text: 'bar' }
          ]
        });

        let doc = yield Model.findOne({}).select('title');
        assert.ok(!doc.sections);

        doc = yield Model.findOne({}).select('title sections.title');
        assert.ok(doc.sections);
        assert.equal(doc.sections[0].kind, 'image');
        assert.equal(doc.sections[1].kind, 'text');
      });
    });

    it('merges schemas instead of overwriting (gh-7884)', function() {
      const opts = { discriminatorKey: 'kind' };

      const eventSchema = Schema({ lookups: [{ name: String }] }, opts);
      const Event = db.model('Test', eventSchema);

      const ClickedLinkEvent = Event.discriminator('Clicked', Schema({
        lookups: [{ hi: String }],
        url: String
      }, opts));

      const e = new ClickedLinkEvent({
        lookups: [{
          hi: 'address1',
          name: 'address2'
        }],
        url: 'google.com'
      });
      assert.equal(e.lookups.length, 1);
      assert.equal(e.lookups[0].hi, 'address1');
      assert.equal(e.get('lookups.0.name'), 'address2');
      assert.equal(e.lookups[0].name, 'address2');
    });

    it('_id: false in discriminator nested schema (gh-8274)', function() {
      const schema = new Schema({
        operations: {
          type: [{ _id: Number, action: String }]
        }
      });
      schema.path('operations').discriminator('Pitch', new Schema({
        pitchPath: Schema({
          _id: Number,
          path: [{ _id: false, x: Number, y: Number }]
        })
      }));
      const Model = db.model('Test', schema);

      const doc = new Model();
      doc.operations.push({
        _id: 42,
        __t: 'Pitch',
        pitchPath: { path: [{ x: 1, y: 2 }] }
      });
      assert.strictEqual(doc.operations[0].pitchPath.path[0]._id, void 0);
    });

    it('with discriminators in embedded arrays (gh-8273)', function(done) {
      const ProductSchema = new Schema({
        title: String
      });
      const Product = db.model('Product', ProductSchema);
      const ProductItemSchema = new Schema({
        product: { type: Schema.Types.ObjectId, ref: 'Product' }
      });

      const OrderItemSchema = new Schema({}, { discriminatorKey: '__t' });

      const OrderSchema = new Schema({
        items: [OrderItemSchema]
      });

      OrderSchema.path('items').discriminator('ProductItem', ProductItemSchema);
      const Order = db.model('Order', OrderSchema);

      const product = new Product({ title: 'Product title' });

      const order = new Order({
        items: [{
          __t: 'ProductItem',
          product: product
        }]
      });
      assert.ok(order.items[0].product.title);
      assert.equal(order.populated('items.product').length, 1);

      done();
    });
  });

  it('attempting to populate on base model a virtual path defined on discriminator does not throw an error (gh-8924)', function() {
    return co(function* () {
      const User = db.model('User', {});
      const Post = db.model('Post', {});

      const userWithPostSchema = new Schema({ postId: Schema.ObjectId });

      userWithPostSchema.virtual('post', { ref: 'Post', localField: 'postId', foreignField: '_id' });

      const UserWithPost = User.discriminator('UserWithPost', userWithPostSchema);

      const post = yield Post.create({});

      yield UserWithPost.create({ postId: post._id });

      const user = yield User.findOne().populate({ path: 'post' });

      assert.ok(user.postId);
    });
  });

  it('accepts a POJO as a schema for discriminators (gh-8984)', function() {
    const User = db.model('User', {});
    const SuperUser = User.discriminator('SuperUser', { ability: String });

    assert.ok(SuperUser.schema.path('ability'));
  });

  it('removes paths underneath mixed type if discriminator schema sets path to mixed (gh-9042)', function() {
    const TestSchema = Schema({ name: String });
    const MainSchema = Schema({ run: { tab: TestSchema } }, {
      discriminatorKey: 'type'
    });
    const Main = db.model('Test', MainSchema);

    const DiscriminatorSchema = Schema({ run: {} });

    const D = Main.discriminator('copy', DiscriminatorSchema);
    assert.ok(!D.schema.paths['run.tab']);

    const doc = new D({ run: { tab: { id: 42 } } });
    assert.ifError(doc.validateSync());
  });

  it('doesnt remove paths at the same level (gh-9362)', function() {
    const StepSchema = new Schema({
      view: {
        url: {
          type: String,
          trim: true
        }
      }
    }, { discriminatorKey: 'type' });

    const ClickSchema = new Schema([
      StepSchema,
      {
        view: {
          clickCount: {
            type: Number,
            default: 1,
            min: 1
          }
        }
      }
    ], { discriminatorKey: 'type' });

    const Test = db.model('Test', StepSchema);
    const D = Test.discriminator('Test1', ClickSchema);
    assert.ok(D.schema.paths['view.url']);

    const doc = new D({ view: { url: 'google.com' } });
    assert.ifError(doc.validateSync());

    assert.equal(doc.view.url, 'google.com');
    assert.equal(doc.view.clickCount, 1);
  });

  it('overwrites if discriminator schema sets a path to single nested but base schema sets to doc array (gh-9354)', function() {
    const A = db.model('Test', Schema({
      prop: [{ reqProp: { type: String, required: true } }]
    }));

    const B = A.discriminator('Test2', Schema({
      prop: Schema({ name: String })
    }));

    assert.ok(!B.schema.path('prop').schema.path('reqProp'));

    const doc = new B({ prop: { name: 'test' } });
    return doc.validate();
  });

  it('can use compiled model schema as a discriminator (gh-9238)', function() {
    const SmsSchema = new mongoose.Schema({ senderNumber: String });
    const EmailSchema = new mongoose.Schema({ fromEmailAddress: String });
    const messageSchema = new mongoose.Schema({ method: String }, { discriminatorKey: 'method' });

    const Message = db.model('Test', messageSchema);
    Message.discriminator('email', EmailSchema);
    Message.discriminator('sms', SmsSchema);

    const schema = new mongoose.Schema({ actions: [{ name: String }] });
    const actions = schema.path('actions');

    actions.discriminator('message', Message.schema);
    assert.ok(actions.schema.discriminators['message']);
  });

  it('embedded discriminator array of arrays (gh-9984)', function() {
    const enemySchema = new Schema({
      name: String,
      level: Number
    });
    const Enemy = db.model('Enemy', enemySchema);

    const mapSchema = new Schema({
      tiles: [[new Schema({}, { discriminatorKey: 'kind', _id: false })]]
    });

    const contentPath = mapSchema.path('tiles');

    contentPath.discriminator('Enemy', new Schema({
      enemy: { type: Schema.Types.ObjectId, ref: 'Enemy' }
    }));
    contentPath.discriminator('Wall', new Schema({ color: String }));

    const Map = db.model('Map', mapSchema);

    return co(function*() {
      const e = yield Enemy.create({
        name: 'Bowser',
        level: 10
      });

      let map = yield Map.create({
        tiles: [[{ kind: 'Enemy', enemy: e._id }, { kind: 'Wall', color: 'Blue' }]]
      });

      map = yield Map.findById(map).populate({ path: 'tiles.enemy' });
      assert.equal(map.tiles[0][0].enemy.name, 'Bowser');
    });
  });

  it('recursive embedded discriminator using schematype (gh-9600)', function() {
    const contentSchema = new mongoose.Schema({}, { discriminatorKey: 'type' });
    const nestedSchema = new mongoose.Schema({
      body: {
        children: [contentSchema]
      }
    });
    const childrenArraySchema = nestedSchema.path('body.children');
    childrenArraySchema.discriminator(
      'container',
      new mongoose.Schema({
        body: { children: childrenArraySchema }
      }),
      { clone: false }
    );
    const Nested = mongoose.model('nested', nestedSchema);

    const nestedDocument = new Nested({
      body: {
        children: [
          { type: 'container', body: { children: [] } },
          {
            type: 'container',
            body: {
              children: [
                {
                  type: 'container',
                  body: {
                    children: [{ type: 'container', body: { children: [] } }]
                  }
                }
              ]
            }
          }
        ]
      }
    });

    assert.deepEqual(nestedDocument.body.children[1].body.children[0].body.children[0].body.children, []);
  });

  describe('Discriminator Key test', function() {
    it('gh-9015', function() {
      return co(function*() {
        const baseSchema = new Schema({}, { discriminatorKey: 'type' });
        const baseModel = db.model('thing', baseSchema);
        const aSchema = new Schema(
          {
            aThing: { type: Number }
          },
          { _id: false, id: false }
        );
        baseModel.discriminator('A', aSchema);
        const bSchema = new Schema(
          {
            bThing: { type: String }
          },
          { _id: false, id: false }
        );
        baseModel.discriminator('B', bSchema);
        // Model is created as a type A
        let doc = yield baseModel.create({ type: 'A', aThing: 1 });
        let res = yield baseModel.findByIdAndUpdate(
          doc._id,
          { type: 'B', bThing: 'one', aThing: '2' },
          { runValidators: true, /* overwriteDiscriminatorKey: true, */ new: true }
        );
        assert.equal(res.type, 'A');

        doc = yield baseModel.create({ type: 'A', aThing: 1 });
        res = yield baseModel.findByIdAndUpdate(
          doc._id,
          { type: 'B', bThing: 'one', aThing: '2' },
          { runValidators: true, overwriteDiscriminatorKey: true, new: true }
        );
        assert.equal(res.type, 'B');
      });
    });
  });

  it('takes discriminator schema\'s single nested over base schema\'s (gh-10157)', function() {
    const personSchema = new Schema({
      name: Schema({ firstName: String, lastName: String }),
      kind: { type: 'String', enum: ['normal', 'vip'], required: true }
    }, { discriminatorKey: 'kind' });

    const Person = db.model('Person', personSchema);

    const vipSchema = Schema({
      name: Schema({
        firstName: { type: 'String', required: true },
        title: { type: 'String', required: true }
      })
    });
    const Vip = Person.discriminator('vip', vipSchema);

    const doc1 = new Vip({ name: { firstName: 'John' } });
    let err = doc1.validateSync();
    assert.ok(err);
    assert.ok(err.errors['name.title']);

    const doc2 = new Vip({ name: { title: 'Dr' } });
    err = doc2.validateSync();
    assert.ok(err);
    assert.ok(err.errors['name.firstName']);
  });

  it('allows using array as tied value (gh-10303)', function() {
    const mongooseSchema = new mongoose.Schema({
      tenantRefs: [{
        type: String,
        required: true
      }],
      otherData: {
        type: String,
        required: true
      }
    }, { discriminatorKey: 'tenantRefs' });
    const Model = db.model('Test', mongooseSchema);

    const D = Model.discriminator('D', Schema({}), ['abc', '123']);

    return D.create({ otherData: 'test', tenantRefs: ['abc', '123'] }).then(res => {
      assert.deepEqual(res.toObject().tenantRefs, ['abc', '123']);
    });
  });
});
