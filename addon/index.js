import Ember from 'ember';

const observer = Ember.observer;
const on = Ember.on;

export function nestedArrayObserver(dependentArrayKey, observerFn) {
  // Since we have to create observer functions on-the-fly (see the .bind()
  // calls below), we cache the observer functions so we can remove them when a
  // nested array is dropped.
  const observerCache = Ember.A();

  return arrayMemberObserver(dependentArrayKey, {
    added(nestedArray) {
      const cached = {
        target: nestedArray,
        observer: observerFn.bind(this, nestedArray)
      };
      observerCache.pushObject(cached);
      nestedArray.addObserver('[]', this, cached.observer);
    },
    removed(nestedArray) {
      const cached = observerCache.find((item) => item.target === nestedArray);
      nestedArray.removeObserver('[]', this, cached.observer);
      observerCache.removeObject(cached);
    }
  });
}

export function arrayMemberObserver(dependentArrayKey, observers) {
  return observer(dependentArrayKey + '.[]', on('init', function() {
    this.get(dependentArrayKey).forEach((member) => {
      observers.added.call(this, member);
    });
    this.get(dependentArrayKey).addArrayObserver({
      arrayWillChange(array, start, addedCount, removedCount) {
        array.slice(start, removedCount).forEach(observers.removed.bind(this));
      },
      arrayDidChange(array, start, addedCount) {
        array.slice(start, addedCount).forEach(observers.added.bind(this));
      }
    });
  }));
}
