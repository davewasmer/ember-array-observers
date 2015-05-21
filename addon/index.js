import Ember from 'ember';

const on = Ember.on;
const computed = Ember.computed;
const assert = Ember.assert;

/**
 * Use instanceScoped to create a computed property that has a private closure
 * scope per instance.
 *
 * @param  {String} key                        property to assign the computed
 *                                             property
 * @param  {Function} computedPropertyFactory  a function that returns a
 *                                             computed property definition, and
 *                                             can be used to provide a closure
 *                                             scope for each instance
 */
function instanceScoped(key, computedPropertyFactory) {
  return on('init', function() {
    Ember.defineProperty(this, key, computedPropertyFactory());
  });
}


/**
 * Observe inner arrays in an two dimensional array (array of arrays).
 *
 * @param {String} dependentArrayKey  the underlying array of arrays to observe
 * @param {Function} observerFn       observer function to be called anytime
 *                                    one of the inner arrays adds or removes an
 *                                    element.
 */
export function nestedArrayObserver(dependentArrayKey, observerFn) {
  // Since we have to create observer functions on-the-fly (see the .bind()
  // calls below), we cache the observer functions so we can remove them when a
  // nested array is dropped.
  //
  // This cache will be shared across all instances of the class though, so we
  // include the instance in the cache key to avoid lookups returning other
  // instances' cached values.
  const observerCache = Ember.A();

  return arrayMemberObserver(dependentArrayKey, {
    added(nestedArray) {
      assert(`The outer array contains a non-array value (${nestedArray}). nestedArrayObserver must be used on an array of arrays.`, Ember.isArray(nestedArray));
      // Create the cached observer function
      const cached = {
        parent: this,
        target: nestedArray,
        observer: observerFn.bind(this, nestedArray)
      };
      observerCache.pushObject(cached);
      // Add the observer
      nestedArray.addObserver('[]', this, cached.observer);
      // Immediately invoke the observer since the nested array "changed" - it's
      // actually a new array, but the nestedArrayObserver macro allows the user
      // to ignore that fact and treat the nested arrays as pointers rather than
      // references, essentially
      cached.observer();
    },
    removed(nestedArray) {
      const cached = observerCache.find((item) => {
        return item.target === nestedArray && item.parent === this;
      });
      if (cached) {
        nestedArray.removeObserver('[]', this, cached.observer);
        observerCache.removeObject(cached);
      }
    }
  });
}

/**
 * Provides callbacks for whenever an item is added or removed from the
 * dependent array.
 *
 * @param {String} dependentArrayKey  the underlying array to observe
 * @param {Object} observers
 * @param {Object} observers.added    called with the item being added to the
 *                                    underlying array
 * @param {Object} observers.removed  called with the item being removed from
 *                                    the underlying array
 */
export function arrayMemberObserver(dependentArrayKey, observers) {
  return on('init', function() {
    assert(`arrayMemberObserver only works on arrays. The dependent key you provided ('${dependentArrayKey}') is not an array (${this.get(dependentArrayKey)}).`, Ember.isArray(this.get(dependentArrayKey)));

    // Cache the reference to the previous array so we can teardown listerners
    let previousArray;

    let observeDependentArray = () => {
      // The dependent key could have been nulled out, so ignore non-array
      // values
      if (Array.isArray(this.get(dependentArrayKey))) {
        // Teardown the old listeners
        if (previousArray) {
          previousArray.removeArrayObserver();
          if (observers.removed) {
            previousArray.map(observers.removed.bind(this));
          }
        }
        previousArray = this.get(dependentArrayKey);
        // The dependent array is a new array, so immediately invoke the added
        // observer for every item in the array
        this.get(dependentArrayKey).forEach((member) => {
          observers.added.call(this, member);
        });
        // Add an ArrayObserver so future changes will invoke the user's observers
        this.get(dependentArrayKey).addArrayObserver({
          arrayWillChange: (array, start, removedCount) => {
            if (removedCount > 0 && observers.removed) {
              array.slice(start, start + removedCount).forEach((item, i) => {
                observers.removed.call(this, item, i + start);
              });
            }
          },
          arrayDidChange: (array, start, removedCount, addedCount) => {
            if (addedCount > 0 && observers.added) {
              array.slice(start, start + addedCount).forEach((item, i) => {
                observers.added.call(this, item, i + start);
              });
            }
          }
        });
      }
    };

    // Setup the appropriate observers on the initial value of this array
    observeDependentArray();

    // Watch the dependent key for changes - it could be assigned a totally
    // different array.
    this.addObserver(dependentArrayKey, observeDependentArray)

  });
}

/**
 * An array that, when set, will invoke the supplied merge function on the
 * source and the incoming array. Default implementation merges the incoming
 * array and preserves the source array reference.
 *
 * @param {Function} mergeFn  function that accepts a source and an update
 *                            array, and returns the result of the set. Default
 *                            implementation is an array merge that preserves
 *                            the source array references.
 */
export function mergedArray(key, mergeFn) {
  mergeFn = mergeFn || mergeArrays;
  return instanceScoped(key, function() {
    let source = Ember.A();
    return computed({
      get() {
        return source;
      },
      set(key, update) {
        return mergeFn(source, update);
      }
    });
  });
}

/**
 * Take two arrays, and an optional comparator, and merge them such that the
 * first array ends up looking exactly like the second, but does so via mutation
 * (pushObject and removeObject) to preserve the original array reference.
 *
 * @param {Array} original      array to mutate
 * @param {Array} update        original array will end up looking exactly
 *                              like update
 * @param {Function} comparator function that takes an item from each array
 *                              and returns true if they should be considered
 *                              the same
 */
export function mergeArrays(original, update, comparator) {
  comparator = comparator || function(a, b) { return a === b; };
  update.forEach((item) => {
    if (!original.find(comparator.bind(this, item))) {
      original.pushObject(item);
    }
  });
  original.forEach((item) => {
    if (!update.find(comparator.bind(this, item))) {
      original.removeObject(item);
    }
  });
  return original;
}

/**
 * Computed property representing an underlying array as a string of joined
 * values separated by `separator`.
 *
 * @param {String} dependentArrayKey  the underlying array to represent
 * @param {String} separator          a string separator to join array itmes
 *                                    with
 * @param {Function} mergeArrays      a function to merge the incoming array
 *                                    with the existing array when setting a
 *                                    value. Default implementation merges the
 *                                    two arrays in place by strict equality
 *                                    comparisons. Called with the class as it's
 *                                    context so you can set a new value for the
 *                                    array rather than mutate in place if
 *                                    needed.
 */
export function joinedArray(dependentArrayKey, separator, mergeFn) {
  let defaultValue;

  // Default merging function does an in-place update
  mergeFn = mergeFn || mergeArrays;

  return computed(dependentArrayKey + '.[]', {
    get() {
      // Cache the default value in case this ever gets unset
      if (!defaultValue) {
        defaultValue = this.get(dependentArrayKey) || [];
      }
      let value = this.get(dependentArrayKey);
      assert(`joinedArray only works on arrays. The dependent key you provided ('${this.get(dependentArrayKey)}') is not an array.`, Ember.isNone(value) || Ember.isArray(value));
      return value && value.join(separator);
    },
    set(key, value) {
      assert(`You must supply a string when setting a joinedArray computed value. The value you provided ('${value}') is not an array.`, Ember.isNone(value) || Ember.typeOf(value) === 'string');
      // Cache the default value in case this ever gets unset
      if (!defaultValue) {
        defaultValue = this.get(dependentArrayKey) || [];
      }
      // If a new value is supplied, split it and in-place update the array to
      // match the string. If no value is supplied, use the previously cached
      // default value.
      let newItems;
      let oldItems = this.get(dependentArrayKey);
      if (typeof value === 'string') {
        if (Ember.isEmpty(value)) {
          newItems = [];
        } else {
          newItems = value.split(separator);
        }
      } else {
        newItems = defaultValue;
      }
      let result = mergeFn.call(this, oldItems, newItems);
      return result.join(separator);
    }
  });
}
